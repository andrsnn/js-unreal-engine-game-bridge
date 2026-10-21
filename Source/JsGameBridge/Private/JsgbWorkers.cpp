#include "JsgbWorkers.h"
#include "HAL/RunnableThread.h"
#include "HAL/Event.h"
#include "HAL/PlatformProcess.h"
#include "JsEnvModule.h"

THIRD_PARTY_INCLUDES_START
#include "v8.h"
#include "libplatform/libplatform.h"
#include "v8-profiler.h"
THIRD_PARTY_INCLUDES_END
#include "JsgbBridge.h"
#include "Misc/FileHelper.h"

DEFINE_LOG_CATEGORY_STATIC(LogJsgbWorker, Log, All);

namespace
{
	FCriticalSection BlobLock;
	TMap<FString, TPair<TArray<uint8>, FString>> BlobMap;
}
void FJsgbBlobs::Put(const FString& Url, TArray<uint8>&& Bytes, const FString& Type) { FScopeLock Lock(&BlobLock); BlobMap.Add(Url, TPair<TArray<uint8>, FString>(MoveTemp(Bytes), Type)); }
bool FJsgbBlobs::Get(const FString& Url, TArray<uint8>& Bytes, FString& Type)
{
	FScopeLock Lock(&BlobLock);
	const TPair<TArray<uint8>, FString>* Found = BlobMap.Find(Url);
	if (!Found) { return false; }
	Bytes = Found->Key; Type = Found->Value;
	return true;
}
void FJsgbBlobs::Revoke(const FString& Url) { FScopeLock Lock(&BlobLock); BlobMap.Remove(Url); }
void FJsgbBlobs::Clear() { FScopeLock Lock(&BlobLock); BlobMap.Reset(); }

namespace
{
	FJsgbWorker* Self(const v8::FunctionCallbackInfo<v8::Value>& Info) { return static_cast<FJsgbWorker*>(Info.Data().As<v8::External>()->Value()); }

	FString ToString(v8::Isolate* I, v8::Local<v8::Value> V)
	{
		v8::String::Utf8Value Utf8(I, V);
		return *Utf8 ? FString(UTF8_TO_TCHAR(*Utf8)) : FString();
	}

	v8::Local<v8::String> V8String(v8::Isolate* I, const FString& S)
	{
		FTCHARToUTF8 Utf8(*S);
		return v8::String::NewFromUtf8(I, Utf8.Get(), v8::NewStringType::kNormal, Utf8.Length()).ToLocalChecked();
	}

	TArray<uint8> BytesOf(v8::Local<v8::Value> V)
	{
		TArray<uint8> Out;
		if (V->IsArrayBuffer())
		{
			std::shared_ptr<v8::BackingStore> Store = V.As<v8::ArrayBuffer>()->GetBackingStore();
			Out.Append(static_cast<const uint8*>(Store->Data()), static_cast<int32>(Store->ByteLength()));
		}
		return Out;
	}

	v8::Local<v8::ArrayBuffer> ArrayBufferOf(v8::Isolate* I, const TArray<uint8>& Bytes)
	{
		v8::Local<v8::ArrayBuffer> B = v8::ArrayBuffer::New(I, Bytes.Num());
		if (Bytes.Num()) { FMemory::Memcpy(B->GetBackingStore()->Data(), Bytes.GetData(), Bytes.Num()); }
		return B;
	}

	void JsPost(const v8::FunctionCallbackInfo<v8::Value>& Info) { if (Info.Length() > 0) { Self(Info)->SendFromWorker(BytesOf(Info[0]), false); } }
	void JsClose(const v8::FunctionCallbackInfo<v8::Value>& Info) { Self(Info)->bClosed = true; }
	void JsNow(const v8::FunctionCallbackInfo<v8::Value>& Info) { Info.GetReturnValue().Set((FPlatformTime::Seconds() - Self(Info)->StartSeconds) * 1000.0); }
	void JsLog(const v8::FunctionCallbackInfo<v8::Value>& Info)
	{
		v8::Isolate* I = Info.GetIsolate();
		const FString Level = Info.Length() > 0 ? ToString(I, Info[0]) : FString();
		const FString Text = Info.Length() > 1 ? ToString(I, Info[1]) : FString();
		// A worker interrupted by Stop reports an empty error; that is expected.
		if (Self(Info)->IsStopping()) { return; }
		if (Level == TEXT("error")) { UE_LOG(LogJsgbWorker, Warning, TEXT("worker %s: %s"), *Self(Info)->Name, *Text.Left(4000)); }
		else { UE_LOG(LogJsgbWorker, Display, TEXT("worker %s: %s"), *Self(Info)->Name, *Text.Left(4000)); }
	}
	void JsWorkerId(const v8::FunctionCallbackInfo<v8::Value>& Info) { Info.GetReturnValue().Set(Self(Info)->Id); }
	void JsBlobPut(const v8::FunctionCallbackInfo<v8::Value>& Info)
	{
		v8::Isolate* I = Info.GetIsolate();
		if (Info.Length() >= 2) { FJsgbBlobs::Put(ToString(I, Info[0]), BytesOf(Info[1]), Info.Length() > 2 ? ToString(I, Info[2]) : FString()); }
	}
	void JsBlobGet(const v8::FunctionCallbackInfo<v8::Value>& Info)
	{
		v8::Isolate* I = Info.GetIsolate();
		TArray<uint8> Bytes; FString Type;
		if (Info.Length() < 1 || !FJsgbBlobs::Get(ToString(I, Info[0]), Bytes, Type)) { Info.GetReturnValue().SetNull(); return; }
		v8::Local<v8::Array> Out = v8::Array::New(I, 2);
		v8::Local<v8::Context> Ctx = I->GetCurrentContext();
		Out->Set(Ctx, 0, ArrayBufferOf(I, Bytes)).Check();
		Out->Set(Ctx, 1, V8String(I, Type)).Check();
		Info.GetReturnValue().Set(Out);
	}
	void JsBlobRevoke(const v8::FunctionCallbackInfo<v8::Value>& Info) { if (Info.Length() > 0) { FJsgbBlobs::Revoke(ToString(Info.GetIsolate(), Info[0])); } }
	void JsReadFile(const v8::FunctionCallbackInfo<v8::Value>& Info)
	{
		v8::Isolate* I = Info.GetIsolate();
		const TArray<uint8> Bytes = Info.Length() > 0 ? Self(Info)->ReadFile(ToString(I, Info[0])) : TArray<uint8>();
		if (Bytes.Num()) { Info.GetReturnValue().Set(ArrayBufferOf(I, Bytes)); } else { Info.GetReturnValue().SetNull(); }
	}

	bool RunScript(v8::Isolate* I, v8::Local<v8::Context> Ctx, const FString& Code, const FString& Name, FString& Error)
	{
		v8::TryCatch Try(I);
#if V8_MAJOR_VERSION >= 12
		v8::ScriptOrigin Origin(V8String(I, Name));
#else
		v8::ScriptOrigin Origin(I, V8String(I, Name));
#endif
		v8::Local<v8::Script> Script;
		if (!v8::Script::Compile(Ctx, V8String(I, Code), &Origin).ToLocal(&Script) || Script->Run(Ctx).IsEmpty())
		{
			v8::Local<v8::Value> Stack;
			Error = Try.HasCaught() ? (Try.StackTrace(Ctx).ToLocal(&Stack) ? ToString(I, Stack) : ToString(I, Try.Exception())) : TEXT("script failed");
			return false;
		}
		return true;
	}

	bool CallGlobal(v8::Isolate* I, v8::Local<v8::Context> Ctx, const char* Name, int Argc, v8::Local<v8::Value>* Argv, v8::Local<v8::Value>* Result, FString& Error)
	{
		v8::TryCatch Try(I);
		v8::Local<v8::Value> Fn;
		if (!Ctx->Global()->Get(Ctx, v8::String::NewFromUtf8(I, Name).ToLocalChecked()).ToLocal(&Fn) || !Fn->IsFunction()) { Error = FString::Printf(TEXT("%hs is missing"), Name); return false; }
		v8::Local<v8::Value> Out;
		if (!Fn.As<v8::Function>()->Call(Ctx, Ctx->Global(), Argc, Argv).ToLocal(&Out))
		{
			v8::Local<v8::Value> Stack;
			Error = Try.HasCaught() ? (Try.StackTrace(Ctx).ToLocal(&Stack) ? ToString(I, Stack) : ToString(I, Try.Exception())) : TEXT("call failed");
			return false;
		}
		if (Result) { *Result = Out; }
		return true;
	}
}

FJsgbWorker::FJsgbWorker(int32 InId, const FString& InName, const FString& InRuntime, const FString& InSource, const FString& InUrl, TFunction<TArray<uint8>(const FString&)> InReadFile)
	: Id(InId), Name(InName), Runtime(InRuntime), Source(InSource), Url(InUrl), ReadFileFn(MoveTemp(InReadFile))
{
	StartSeconds = FPlatformTime::Seconds();
	Wake = FPlatformProcess::GetSynchEventFromPool(false);
	Thread = FRunnableThread::Create(this, *FString::Printf(TEXT("JsgbWorker%d"), Id), 0, TPri_BelowNormal);
}

FJsgbWorker::~FJsgbWorker()
{
	Stop();
	if (Thread) { Thread->WaitForCompletion(); delete Thread; Thread = nullptr; }
	FPlatformProcess::ReturnSynchEventToPool(Wake);
}

void FJsgbWorker::Post(TArray<uint8>&& Bytes) { Inbox.Enqueue(MoveTemp(Bytes)); Wake->Trigger(); }
void FJsgbWorker::Stop()
{
	bStop = true;
	if (Wake) { Wake->Trigger(); }
	// A worker in the middle of a long job is interrupted, so a hot reload doesn't wait for it.
	if (void* I = Isolate.Load()) { static_cast<v8::Isolate*>(I)->TerminateExecution(); }
}

void FJsgbWorker::Drain(TArray<TPair<TArray<uint8>, bool>>& Out)
{
	TPair<TArray<uint8>, bool> Item;
	while (Outbox.Dequeue(Item)) { Out.Add(MoveTemp(Item)); }
}

uint32 FJsgbWorker::Run()
{
	v8::Platform* Platform = static_cast<v8::Platform*>(IJsEnvModule::Get().GetV8Platform());
	v8::Isolate::CreateParams Params;
	Params.array_buffer_allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
	v8::Isolate* I = v8::Isolate::New(Params);
	Isolate = I;
	{
		// Once any engine in the process is used under v8::Locker (Puerts built THREAD_SAFE), V8 requires
		// every isolate to be entered that way. The worker owns its isolate, so it holds the lock throughout.
		v8::Locker Lock(I);
		v8::Isolate::Scope IsolateScope(I);
		v8::HandleScope Handles(I);
		v8::Local<v8::External> Data = v8::External::New(I, this);
		v8::Local<v8::ObjectTemplate> Global = v8::ObjectTemplate::New(I);
		Global->Set(I, "__post", v8::FunctionTemplate::New(I, &JsPost, Data));
		Global->Set(I, "__close", v8::FunctionTemplate::New(I, &JsClose, Data));
		Global->Set(I, "__now", v8::FunctionTemplate::New(I, &JsNow, Data));
		Global->Set(I, "__log", v8::FunctionTemplate::New(I, &JsLog, Data));
		Global->Set(I, "__readFile", v8::FunctionTemplate::New(I, &JsReadFile, Data));
		Global->Set(I, "__workerId", v8::FunctionTemplate::New(I, &JsWorkerId, Data));
		Global->Set(I, "__blobPut", v8::FunctionTemplate::New(I, &JsBlobPut, Data));
		Global->Set(I, "__blobGet", v8::FunctionTemplate::New(I, &JsBlobGet, Data));
		Global->Set(I, "__blobRevoke", v8::FunctionTemplate::New(I, &JsBlobRevoke, Data));
		v8::Local<v8::Context> Ctx = v8::Context::New(I, nullptr, Global);
		v8::Context::Scope ContextScope(Ctx);

		FString Error;
		v8::Local<v8::Value> Args[2] = {V8String(I, Source), V8String(I, Url)};
		if (!RunScript(I, Ctx, Runtime, TEXT("jsgb-worker-runtime.js"), Error) || !CallGlobal(I, Ctx, "__start", 2, Args, nullptr, Error))
		{
			FTCHARToUTF8 Utf8(*Error);
			SendFromWorker(TArray<uint8>(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length()), true);
			UE_LOG(LogJsgbWorker, Warning, TEXT("worker %s failed to start: %s"), *Name, *Error.Left(2000));
		}
		else
		{
			while (!bStop && !bClosed)
			{
				TArray<uint8> Bytes;
				while (!bStop && Inbox.Dequeue(Bytes))
				{
					v8::HandleScope Inner(I);
					const double DispatchStart = FPlatformTime::Seconds();
					v8::Local<v8::Value> Arg = ArrayBufferOf(I, Bytes);
					if (!CallGlobal(I, Ctx, "__dispatch", 1, &Arg, nullptr, Error) && !bStop) { UE_LOG(LogJsgbWorker, Warning, TEXT("worker %s: %s"), *Name, *Error.Left(2000)); }
					I->PerformMicrotaskCheckpoint();
					// A long job on a worker holds up whatever the game waits for (terrain, decoding), so it goes in the log.
					const double DispatchMs = (FPlatformTime::Seconds() - DispatchStart) * 1000.0;
					if (DispatchMs > 250.0) { UE_LOG(LogJsgbWorker, Display, TEXT("worker %s: a %d-byte message took %.0f ms"), *Name, Bytes.Num(), DispatchMs); }
				}
				double WaitMs = 50;
				{
					v8::HandleScope Inner(I);
					v8::Local<v8::Value> Next;
					if (CallGlobal(I, Ctx, "__tick", 0, nullptr, &Next, Error) && Next->IsNumber()) { WaitMs = Next.As<v8::Number>()->Value(); }
				}
				I->PerformMicrotaskCheckpoint();
				// Background tasks V8 posts back to this isolate (WebAssembly compilation, finalization).
				bool bWork = false;
				while (v8::platform::PumpMessageLoop(Platform, I)) { bWork = true; }
				if (bWork) { I->PerformMicrotaskCheckpoint(); continue; }
				if (WaitMs > 0 && Inbox.IsEmpty()) { Wake->Wait(FMath::Clamp(static_cast<uint32>(WaitMs), 1u, 5u)); }
			}
		}
	}
	Isolate = nullptr;
	I->Dispose();
	delete Params.array_buffer_allocator;
	return 0;
}

namespace
{
	/** Collects V8's JSON profile in memory. */
	struct FJsgbProfileText : public v8::OutputStream
	{
		TArray<uint8> Bytes;
		virtual void EndOfStream() override {}
		virtual WriteResult WriteAsciiChunk(char* Data, int Size) override { Bytes.Append(reinterpret_cast<uint8*>(Data), Size); return kContinue; }
	};
	v8::CpuProfiler* GJsgbProfiler = nullptr;
}

FString UJsgbBridge::ProfileJs(const FString& Command)
{
	v8::Isolate* I = v8::Isolate::GetCurrent();
	if (!I) { return TEXT("no isolate on this thread"); }
	v8::HandleScope Scope(I);
	const v8::Local<v8::String> Title = v8::String::NewFromUtf8Literal(I, "jsgb");
	if (Command == TEXT("start"))
	{
		if (!GJsgbProfiler) { GJsgbProfiler = v8::CpuProfiler::New(I); GJsgbProfiler->SetSamplingInterval(250); }
		GJsgbProfiler->StartProfiling(Title, true);
		return TEXT("started");
	}
	if (Command.StartsWith(TEXT("stop ")) && GJsgbProfiler)
	{
		v8::CpuProfile* Profile = GJsgbProfiler->StopProfiling(Title);
		if (!Profile) { return TEXT("no profile"); }
		FJsgbProfileText Out;
		Profile->Serialize(&Out);
		Profile->Delete();
		const FString File = Command.Mid(5).TrimStartAndEnd();
		FFileHelper::SaveArrayToFile(Out.Bytes, *File);
		return FString::Printf(TEXT("wrote %d bytes to %s"), Out.Bytes.Num(), *File);
	}
	return TEXT("use start or stop <file>");
}
