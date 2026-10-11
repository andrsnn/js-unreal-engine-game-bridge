#pragma once

#include "CoreMinimal.h"
#include "HAL/Runnable.h"
#include "Containers/Queue.h"

/** Web Workers on their own threads, each with its own V8 isolate, as in a browser. The game's
 *  thread posts messages as bytes (clone.ts encoding) and polls the replies once per frame, so a
 *  worker's work (texture transcoding, mesh decoding, terrain generation) never stalls a frame. */
/** Blob URLs shared by every JavaScript engine (the page and its worker threads). */
struct JSGAMEBRIDGE_API FJsgbBlobs
{
	static void Put(const FString& Url, TArray<uint8>&& Bytes, const FString& Type);
	static bool Get(const FString& Url, TArray<uint8>& Bytes, FString& Type);
	static void Revoke(const FString& Url);
	static void Clear();
};

class JSGAMEBRIDGE_API FJsgbWorker : public FRunnable
{
public:
	/** ReadFile resolves a worker's file loads the way the page's loads resolve. */
	FJsgbWorker(int32 InId, const FString& InName, const FString& InRuntime, const FString& InSource, const FString& InUrl, TFunction<TArray<uint8>(const FString&)> InReadFile);
	virtual ~FJsgbWorker() override;

	void Post(TArray<uint8>&& Bytes);
	/** Messages and errors the worker sent since the last call: (bytes, is error). */
	void Drain(TArray<TPair<TArray<uint8>, bool>>& Out);
	void Stop();
	bool IsStopping() const { return bStop; }

	const int32 Id;
	const FString Name;

	// FRunnable
	virtual uint32 Run() override;

	// Called from the worker's isolate.
	void SendFromWorker(TArray<uint8>&& Bytes, bool bError) { Outbox.Enqueue(TPair<TArray<uint8>, bool>(MoveTemp(Bytes), bError)); }
	TArray<uint8> ReadFile(const FString& Path) const { return ReadFileFn(Path); }
	double StartSeconds = 0;
	TAtomic<bool> bClosed{false};

private:
	FString Runtime, Source, Url;
	TFunction<TArray<uint8>(const FString&)> ReadFileFn;
	TQueue<TArray<uint8>, EQueueMode::Mpsc> Inbox;
	TQueue<TPair<TArray<uint8>, bool>, EQueueMode::Mpsc> Outbox;
	FEvent* Wake = nullptr;
	TAtomic<bool> bStop{false};
	TAtomic<void*> Isolate{nullptr};
	FRunnableThread* Thread = nullptr;
};
