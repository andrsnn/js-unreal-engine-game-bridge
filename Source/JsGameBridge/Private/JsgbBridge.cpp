#include "JsgbBridge.h"
#include "GameFramework/GameUserSettings.h"
#include "RHI.h"
#include "JsgbWorkers.h"
#include "JsgbSceneMirror.h"
#include "JsgbAudio.h"
#include "HAL/PlatformTime.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/ScopeLock.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/SecureHash.h"
#include "Async/Async.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
THIRD_PARTY_INCLUDES_START
#include "ft2build.h"
#include FT_FREETYPE_H
THIRD_PARTY_INCLUDES_END

DEFINE_LOG_CATEGORY_STATIC(LogJsgb, Log, All);

// -JsgbFileLog=<file>: every game file read (from the page or a worker), one per line as "<root>\t<path>", so a
// copy of the game for another PC can take just the files it uses.
static void LogFileRead(const FString& Root, const FString& Rel)
{
	static FString FileLogPath = [] { FString P; FParse::Value(FCommandLine::Get(), TEXT("JsgbFileLog="), P); return P; }();
	if (FileLogPath.IsEmpty()) { return; }
	static FCriticalSection Lock;
	FScopeLock Scope(&Lock);
	FFileHelper::SaveStringToFile(Root + TEXT("\t") + Rel + TEXT("\n"), *FileLogPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM, &IFileManager::Get(), FILEWRITE_Append);
}

int32 UJsgbBridge::WorkerCreate(const FString& Source, const FString& Url, const FString& Name)
{
	if (WorkerRuntime.IsEmpty()) { return 0; }
	const int32 Id = ++NextWorker;
	TArray<FString> Roots = PublicRoots;
	Workers.Add(Id, MakeShared<FJsgbWorker>(Id, Name.IsEmpty() ? FString::FromInt(Id) : Name, WorkerRuntime, Source, Url, [Roots](const FString& Path)
	{
		// The same lookup as ReadFile, on the worker's thread, with its own copy of the roots.
		TArray<uint8> Out;
		FString Rel = Path;
		Rel.ReplaceInline(TEXT("\\"), TEXT("/"));
		while (Rel.StartsWith(TEXT("/"))) { Rel.RightChopInline(1); }
		if (Rel.Contains(TEXT("..")) || Rel.Contains(TEXT(":"))) { return Out; }
		for (const FString& Root : Roots) { const FString Full = Root / Rel; if (FPaths::FileExists(Full) && FFileHelper::LoadFileToArray(Out, *Full, FILEREAD_Silent)) { LogFileRead(Root, Rel); break; } }
		return Out;
	}));
	return Id;
}

void UJsgbBridge::WorkerPost(int32 Id, FArrayBuffer Bytes)
{
	if (TSharedPtr<FJsgbWorker>* W = Workers.Find(Id)) { (*W)->Post(TArray<uint8>(static_cast<const uint8*>(Bytes.Data), Bytes.Length)); }
}

FArrayBufferValue UJsgbBridge::WorkerPoll()
{
	const double T0 = FPlatformTime::Seconds();
	FArrayBufferValue Out;
	TArray<TPair<TArray<uint8>, bool>> Items;
	for (auto& Pair : Workers)
	{
		Items.Reset();
		Pair.Value->Drain(Items);
		for (const TPair<TArray<uint8>, bool>& It : Items)
		{
			if (It.Key.Num() > 4 * 1024 * 1024) { UE_LOG(LogTemp, Display, TEXT("Worker %s message: %.1f MB"), *Pair.Value->Name, It.Key.Num() / 1048576.0); }
			const int32 Header[3] = {Pair.Key, It.Value ? 1 : 0, It.Key.Num()};
			Out.Data.Append(reinterpret_cast<const uint8*>(Header), sizeof(Header));
			Out.Data.Append(It.Key);
			// Keep each record 4-byte aligned for the reader's Int32Array view.
			while (Out.Data.Num() % 4) { Out.Data.Add(0); }
		}
	}
	if (FPlatformTime::Seconds() - T0 > 0.01) { UE_LOG(LogTemp, Display, TEXT("WorkerPoll: %.1f MB in %.1f ms"), Out.Data.Num() / 1048576.0, (FPlatformTime::Seconds() - T0) * 1000.0); }
	return Out;
}

void UJsgbBridge::WorkerTerminate(int32 Id) { if (TSharedPtr<FJsgbWorker> W = Workers.FindRef(Id)) { W->Stop(); Workers.Remove(Id); } }

void UJsgbBridge::BlobPut(const FString& Url, FArrayBuffer Bytes, const FString& Type) { FJsgbBlobs::Put(Url, TArray<uint8>(static_cast<const uint8*>(Bytes.Data), Bytes.Length), Type); }
FArrayBufferValue UJsgbBridge::BlobGet(const FString& Url) { FArrayBufferValue Out; FString Type; FJsgbBlobs::Get(Url, Out.Data, Type); return Out; }
FString UJsgbBridge::BlobType(const FString& Url) { TArray<uint8> Bytes; FString Type; FJsgbBlobs::Get(Url, Bytes, Type); return Type; }
void UJsgbBridge::BlobRevoke(const FString& Url) { FJsgbBlobs::Revoke(Url); }

void UJsgbBridge::RunOnGame(TFunction<void()>&& Fn, bool bFrame, std::source_location From)
{
	if (!bJsThread || IsInGameThread()) { Fn(); return; }
	GameCommands.Enqueue(FGameCommand{MoveTemp(Fn), bFrame, From});
}

int32 UJsgbBridge::DrainGameCommands()
{
	TArray<FGameCommand> Batch;
	FGameCommand Cmd;
	while (GameCommands.Dequeue(Cmd)) { Batch.Add(MoveTemp(Cmd)); }
	int32 LastFrame = INDEX_NONE;
	for (int32 I = 0; I < Batch.Num(); ++I) { if (Batch[I].bFrame) { LastFrame = I; } }
	for (int32 I = 0; I < Batch.Num(); ++I)
	{
		if (Batch[I].bFrame && I != LastFrame) { continue; }
		const double T0 = FPlatformTime::Seconds();
		Batch[I].Fn();
		// A slow command names the bridge function that queued it.
		const double Ms = (FPlatformTime::Seconds() - T0) * 1000.0;
		if (Ms > 15.0) { UE_LOG(LogTemp, Display, TEXT("Slow game-thread command: %.1f ms, queued at %s line %u"), Ms, ANSI_TO_TCHAR(Batch[I].From.function_name()), Batch[I].From.line()); }
	}
	return LastFrame == INDEX_NONE ? 0 : 1;
}

void UJsgbBridge::RunOnJs(TFunction<void()>&& Fn)
{
	if (!bJsThread) { Fn(); return; }
	JsCommands.Enqueue(MoveTemp(Fn));
}

void UJsgbBridge::DrainJsCommands()
{
	TFunction<void()> Fn;
	while (JsCommands.Dequeue(Fn)) { Fn(); }
}

namespace
{
	/** A copy of a buffer JavaScript passed in, kept alive for a call queued to the game thread. */
	struct FBytes
	{
		TArray<uint8> Data;
		explicit FBytes(const FArrayBuffer& B) { if (B.Data && B.Length > 0) { Data.Append(static_cast<const uint8*>(B.Data), static_cast<int32>(B.Length)); } }
		FArrayBuffer View() const { FArrayBuffer B; B.Data = const_cast<uint8*>(Data.GetData()); B.Length = Data.Num(); return B; }
	};
}

void UJsgbBridge::StopWorkers()
{
	FJsgbBlobs::Clear();
	for (auto& Pair : Workers) { Pair.Value->Stop(); }
	Workers.Reset();
}

FArrayBufferValue UJsgbBridge::ReadFile(const FString& Path)
{
	++FilesRead;
	FArrayBufferValue Out;
	FString Rel = Path;
	Rel.ReplaceInline(TEXT("\\"), TEXT("/"));
	while (Rel.StartsWith(TEXT("/"))) { Rel.RightChopInline(1); }
	if (Rel.Contains(TEXT("..")) || Rel.Contains(TEXT(":"))) { return Out; }
	for (const FString& Root : PublicRoots)
	{
		const FString Full = Root / Rel;
		if (FPaths::FileExists(Full) && FFileHelper::LoadFileToArray(Out.Data, *Full, FILEREAD_Silent)) { LogFileRead(Root, Rel); return Out; }
	}
	return Out;
}

double UJsgbBridge::NowMs() const
{
	// Time the mirror spent on first-use meshes and shaders is left out, so the game's timeline
	// matches a browser, where those uploads finish inside the frame.
	return FixedStepMs > 0 ? VirtualMs : (FPlatformTime::Seconds() - StartSeconds) * 1000.0 - (Mirror ? Mirror->StallMs : 0.0);
}

void UJsgbBridge::Log(const FString& Level, const FString& Text)
{
	FScopeLock Lock(&LogLock);
	if (Level == TEXT("error")) { ++ErrorCount; UE_LOG(LogJsgb, Error, TEXT("%s"), *Text); }
	else if (Level == TEXT("warn")) { UE_LOG(LogJsgb, Warning, TEXT("%s"), *Text); }
	else { UE_LOG(LogJsgb, Display, TEXT("%s"), *Text); }
	if (!LogPath.IsEmpty())
	{
		const FString Line = FString::Printf(TEXT("[%.2f] %s %s\n"), NowMs() / 1000.0, *Level, *Text);
		FFileHelper::SaveStringToFile(Line, *LogPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM, &IFileManager::Get(), FILEWRITE_Append);
	}
}

void UJsgbBridge::RequestReload() { bReloadRequested = true; }

FString UJsgbBridge::LoadStore(const FString& Key)
{
	FString Data;
	FFileHelper::LoadFileToString(Data, *(StoreDir / (FMD5::HashAnsiString(*Key) + TEXT(".json"))));
	return Data;
}

void UJsgbBridge::SaveStore(const FString& Key, const FString& Data)
{
	FFileHelper::SaveStringToFile(Data, *(StoreDir / (FMD5::HashAnsiString(*Key) + TEXT(".json"))), FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
}

// Process-wide, so it survives the JS environment restart of a hot reload. Past 4 GB the oldest
// entries go first.
static TMap<FString, TArray<uint8>> GJsgbCache;
static TArray<FString> GJsgbCacheOrder;
static int64 GJsgbCacheBytes = 0;
static constexpr int64 GJsgbCacheLimit = int64(4) << 30;

// The cache is also kept on disk (Saved/JsGameBridge/WorkerCache, up to 4 GB), so a fresh launch
// gets worker results from earlier launches instead of running the jobs on the game thread again.
// Keys hash the worker's source and the message, so a changed worker or message never matches.
static int64 GJsgbDiskBytes = -1;
static constexpr int64 GJsgbDiskLimit = int64(4) << 30;
static FString CacheFile(const FString& Key) { return FPaths::ProjectSavedDir() / TEXT("JsGameBridge") / TEXT("WorkerCache") / (FMD5::HashAnsiString(*Key) + TEXT(".bin")); }

static const TArray<uint8>& Remember(const FString& Key, TArray<uint8>&& Bytes)
{
	if (const TArray<uint8>* Old = GJsgbCache.Find(Key)) { GJsgbCacheBytes -= Old->Num(); GJsgbCache.Remove(Key); GJsgbCacheOrder.Remove(Key); }
	int32 Evict = 0;
	while (GJsgbCacheBytes + Bytes.Num() > GJsgbCacheLimit && Evict < GJsgbCacheOrder.Num())
	{
		if (const TArray<uint8>* Gone = GJsgbCache.Find(GJsgbCacheOrder[Evict])) { GJsgbCacheBytes -= Gone->Num(); GJsgbCache.Remove(GJsgbCacheOrder[Evict]); }
		++Evict;
	}
	if (Evict) { GJsgbCacheOrder.RemoveAt(0, Evict); }
	GJsgbCacheBytes += Bytes.Num();
	GJsgbCacheOrder.Add(Key);
	return GJsgbCache.Add(Key, MoveTemp(Bytes));
}

static FCriticalSection GJsgbCacheLock;

FArrayBufferValue UJsgbBridge::CacheGet(const FString& Key)
{
	FScopeLock Lock(&GJsgbCacheLock);
	FArrayBufferValue Out;
	if (const TArray<uint8>* Found = GJsgbCache.Find(Key)) { Out.Data = *Found; return Out; }
	TArray<uint8> Disk;
	if (FFileHelper::LoadFileToArray(Disk, *CacheFile(Key), FILEREAD_Silent) && Disk.Num() > 0) { Out.Data = Remember(Key, MoveTemp(Disk)); }
	return Out;
}

void UJsgbBridge::CachePut(const FString& Key, FArrayBuffer Bytes)
{
	if (!Bytes.Data || Bytes.Length <= 0) { return; }
	FScopeLock Lock(&GJsgbCacheLock);
	const TArray<uint8>& Kept = Remember(Key, TArray<uint8>(static_cast<const uint8*>(Bytes.Data), Bytes.Length));
	if (GJsgbDiskBytes < 0)
	{
		GJsgbDiskBytes = 0;
		IFileManager::Get().IterateDirectoryStat(*FPaths::GetPath(CacheFile(TEXT("x"))), [](const TCHAR*, const FFileStatData& S) { if (!S.bIsDirectory) { GJsgbDiskBytes += S.FileSize; } return true; });
	}
	const FString File = CacheFile(Key);
	if (GJsgbDiskBytes + Kept.Num() > GJsgbDiskLimit || FPaths::FileExists(File)) { return; }
	GJsgbDiskBytes += Kept.Num();
	// Written off the game thread under a temporary name, then renamed, so a crash never leaves a partial file.
	Async(EAsyncExecution::ThreadPool, [File, Copy = TArray<uint8>(Kept)]()
	{
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(File), true);
		const FString Temp = File + TEXT(".tmp");
		if (FFileHelper::SaveArrayToFile(Copy, *Temp)) { IFileManager::Get().Move(*File, *Temp, true, true); }
	});
}

void UJsgbBridge::JsReady(const FString& Info)
{
	Log(TEXT("log"), TEXT("js ready ") + Info);
	RunOnGame([this] { bReady = true; });
}

void UJsgbBridge::Geometry(int32 Id, FArrayBuffer Positions, FArrayBuffer Normals, FArrayBuffer UVs, FArrayBuffer Colors, int32 ColorSize, FArrayBuffer Indices, const FString& Groups)
{
	if (!bJsThread || IsInGameThread()) { if (Mirror) { Mirror->SetGeometry(Id, Positions, Normals, UVs, Colors, ColorSize, Indices, Groups); } return; }
	// On the JavaScript thread: parse the arrays and build the render buffers here, so the game thread
	// only wraps them in an Unreal mesh.
	TSharedPtr<FJsgbPendingGeometry> G = UJsgbSceneMirror::ParseGeometry(Positions, Normals, UVs, Colors, ColorSize, Indices, Groups);
	if (G->Primitive < 2 && !UJsgbSceneMirror::UseMeshDescription()) { G->Prepared = UJsgbSceneMirror::PrepareMesh(*G); }
	RunOnGame([this, Id, G] { if (Mirror) { Mirror->AcceptGeometry(Id, G); } });
}

void UJsgbBridge::ReleaseGeometry(int32 Id) { RunOnGame([this, Id] { if (Mirror) { Mirror->ReleaseGeometry(Id); } }); }
void UJsgbBridge::Material(int32 Id, const FString& Json)
{
	RunOnGame([this, Id, Json] { const double T0 = FPlatformTime::Seconds(); if (Mirror) { Mirror->SetMaterial(Id, Json); } const double Ms = (FPlatformTime::Seconds() - T0) * 1000.0; MirrorMs += Ms; MaterialMs += Ms; ++MaterialCalls; });
}
void UJsgbBridge::Texture(int32 Id, const FString& Json, FArrayBuffer Bytes)
{
	if (!bJsThread || IsInGameThread())
	{
		const double T0 = FPlatformTime::Seconds();
		if (Mirror) { Mirror->SetTexture(Id, Json, Bytes); }
		const double Ms = (FPlatformTime::Seconds() - T0) * 1000.0; MirrorMs += Ms; TextureMs += Ms; ++TextureCalls;
		return;
	}
	// On the JavaScript thread: read and decode the image here, so the game thread only creates the texture.
	TArray<uint8> FileData;
	if (Json.Contains(TEXT("\"file\"")))
	{
		TSharedPtr<FJsonObject> J;
		FString Path;
		if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), J) && J.IsValid() && J->GetStringField(TEXT("kind")) == TEXT("file") && J->TryGetStringField(TEXT("path"), Path)) { FileData = ReadFile(Path).Data; }
	}
	TSharedPtr<FJsgbPreparedTexture> P = UJsgbSceneMirror::PrepareTexture(Json, Bytes, FileData);
	RunOnGame([this, Id, P] { const double T0 = FPlatformTime::Seconds(); if (Mirror) { Mirror->AcceptTexture(Id, P); } const double Ms = (FPlatformTime::Seconds() - T0) * 1000.0; MirrorMs += Ms; TextureMs += Ms; ++TextureCalls; });
}
void UJsgbBridge::Events(const FString& Json) { RunOnGame([this, Json] { if (Mirror) { Mirror->ApplyEvents(Json); } }); }
void UJsgbBridge::Shader(const FString& Key, const FString& Json) { RunOnGame([this, Key, Json] { if (Mirror) { Mirror->SetShader(Key, Json); } }); }

void UJsgbBridge::Frame(FArrayBuffer Floats, int32 Count, FArrayBuffer Instances, int32 InstanceFloats)
{
	const int32 Available = static_cast<int32>(Floats.Length / sizeof(float));
	const int32 InstAvailable = static_cast<int32>(Instances.Length / sizeof(float));
	const int32 N = FMath::Clamp(Count, 0, Available), NI = FMath::Clamp(InstanceFloats, 0, InstAvailable);
	auto Apply = [this](const float* D, int32 DN, const float* Inst, int32 InstN)
	{
		if (!Mirror) { return; }
		++SceneFrames;
		const double T0 = FPlatformTime::Seconds();
		Mirror->ApplyFrame(D, DN, Inst, InstN);
		MirrorMs += (FPlatformTime::Seconds() - T0) * 1000.0;
	};
	if (!bJsThread || IsInGameThread()) { Apply(static_cast<const float*>(Floats.Data), N, static_cast<const float*>(Instances.Data), NI); return; }
	TArray<float> D(static_cast<const float*>(Floats.Data), N), I(static_cast<const float*>(Instances.Data), NI);
	const double Produced = FPlatformTime::Seconds();
	RunOnGame([this, Apply, Produced, D = MoveTemp(D), I = MoveTemp(I)] { LastFrameProducedAt = Produced; Apply(D.GetData(), D.Num(), I.GetData(), I.Num()); }, true);
}

void UJsgbBridge::PublishUI(const FString& Html)
{
	RunOnGame([this, Html] { UIHtml = Html; ++UIVersion; });
}
void UJsgbBridge::UICanvas(const FString& Id, int32 Width, int32 Height, FArrayBuffer Rgba)
{
	// No pixels means a clear canvas.
	const bool bClear = !Rgba.Data || Rgba.Length == 0;
	if (Width <= 0 || Height <= 0 || (!bClear && Rgba.Length < static_cast<size_t>(Width) * Height * 4)) { return; }
	FUICanvas C;
	C.Width = Width; C.Height = Height;
	if (!bClear) { C.Rgba.Append(static_cast<const uint8*>(Rgba.Data), Width * Height * 4); }
	RunOnGame([this, Id, C = MoveTemp(C)]() mutable { UICanvases.Add(Id, MoveTemp(C)); });
}

void UJsgbBridge::AudioPreload(const FString& Path) { if (Audio) { Audio->Preload(Path); } }
void UJsgbBridge::AudioVoices(const FString& Json) { RunOnGame([this, Json] { if (Audio) { Audio->ApplyVoices(Json); } }); }

void UJsgbBridge::AudioPcm(int32 Id, FArrayBuffer Samples, int32 SampleRate)
{
	RunOnGame([this, Id, S = FBytes(Samples), SampleRate] { if (Audio && S.Data.Num()) { Audio->SetPcm(Id, reinterpret_cast<const float*>(S.Data.GetData()), S.Data.Num() / static_cast<int32>(sizeof(float)), SampleRate); } });
}

namespace
{
	FT_Library FreeTypeLibrary()
	{
		static FT_Library Library = nullptr;
		if (!Library) { FT_Init_FreeType(&Library); }
		return Library;
	}
}

FArrayBufferValue UJsgbBridge::Text(const FString& FontPath, float SizePx, const FString& Run)
{
	static FCriticalSection TextLock;
	FScopeLock Lock(&TextLock);
	FArrayBufferValue Out;
	// Faces stay loaded for the session; FreeType reads from the cached bytes.
	static TMap<FString, TArray<uint8>> FontBytes;
	static TMap<FString, FT_Face> Faces;
	FT_Face* Found = Faces.Find(FontPath);
	if (!Found)
	{
		TArray<uint8>& Bytes = FontBytes.Add(FontPath);
		if (FontPath.StartsWith(TEXT("@engine/"))) { FFileHelper::LoadFileToArray(Bytes, *(FPaths::EngineContentDir() / TEXT("Slate/Fonts") / FontPath.Mid(8))); }
		else { Bytes = ReadFile(FontPath).Data; }
		FT_Face Face = nullptr;
		if (Bytes.Num() == 0 || !FreeTypeLibrary() || FT_New_Memory_Face(FreeTypeLibrary(), Bytes.GetData(), Bytes.Num(), 0, &Face) != 0) { Face = nullptr; }
		Found = &Faces.Add(FontPath, Face);
	}
	FT_Face Face = *Found;
	if (!Face || Run.IsEmpty()) { return Out; }
	FT_Set_Pixel_Sizes(Face, 0, FMath::Clamp(FMath::RoundToInt(SizePx), 1, 512));
	const int32 Ascent = Face->size->metrics.ascender >> 6, Descent = FMath::Max(0, static_cast<int32>(-(Face->size->metrics.descender >> 6)));
	struct FGlyph { TArray<uint8> Alpha; int32 W = 0, H = 0, X = 0, Y = 0; };
	TArray<FGlyph> Glyphs;
	int32 Pen = 0, MinX = 0, MaxX = 0;
	FT_UInt Previous = 0;
	for (int32 I = 0; I < Run.Len(); ++I)
	{
		uint32 Code = Run[I];
		if (Code >= 0xD800 && Code < 0xDC00 && I + 1 < Run.Len()) { Code = 0x10000 + ((Code - 0xD800) << 10) + (Run[I + 1] - 0xDC00); ++I; }
		const FT_UInt Index = FT_Get_Char_Index(Face, Code);
		if (Previous && Index && FT_HAS_KERNING(Face)) { FT_Vector K; FT_Get_Kerning(Face, Previous, Index, FT_KERNING_DEFAULT, &K); Pen += K.x >> 6; }
		Previous = Index;
		if (FT_Load_Glyph(Face, Index, FT_LOAD_RENDER) != 0) { continue; }
		const FT_GlyphSlot Slot = Face->glyph;
		FGlyph G;
		G.W = Slot->bitmap.width; G.H = Slot->bitmap.rows; G.X = Pen + Slot->bitmap_left; G.Y = Ascent - Slot->bitmap_top;
		G.Alpha.SetNumUninitialized(G.W * G.H);
		for (int32 Y = 0; Y < G.H; ++Y) { FMemory::Memcpy(G.Alpha.GetData() + Y * G.W, Slot->bitmap.buffer + Y * Slot->bitmap.pitch, G.W); }
		MinX = FMath::Min(MinX, G.X); MaxX = FMath::Max(MaxX, G.X + G.W);
		Pen += Slot->advance.x >> 6;
		Glyphs.Add(MoveTemp(G));
	}
	const int32 Width = FMath::Max(Pen, MaxX) - FMath::Min(0, MinX), Height = Ascent + Descent, Shift = -FMath::Min(0, MinX);
	if (Width <= 0 || Height <= 0) { return Out; }
	Out.Data.SetNumZeroed(5 * sizeof(float) + Width * Height);
	float* Header = reinterpret_cast<float*>(Out.Data.GetData());
	Header[0] = Width; Header[1] = Height; Header[2] = Ascent; Header[3] = Descent; Header[4] = Pen;
	uint8* Alpha = Out.Data.GetData() + 5 * sizeof(float);
	for (const FGlyph& G : Glyphs)
	{
		for (int32 Y = 0; Y < G.H; ++Y) for (int32 X = 0; X < G.W; ++X)
		{
			const int32 DX = G.X + X + Shift, DY = G.Y + Y;
			if (DX < 0 || DX >= Width || DY < 0 || DY >= Height) { continue; }
			uint8& D = Alpha[DY * Width + DX];
			D = FMath::Max(D, G.Alpha[Y * G.W + X]);
		}
	}
	return Out;
}

// The display settings, through Unreal's game user settings (resolution, window mode, vsync, frame cap).
FString UJsgbBridge::DisplayModes() { FScopeLock Lock(&DisplayLock); return DisplayModesJson; }
FString UJsgbBridge::DisplayGet() { FScopeLock Lock(&DisplayLock); return DisplayJson; }

void UJsgbBridge::UpdateDisplayInfo()
{
	FScreenResolutionArray Resolutions;
	FString Modes = TEXT("[");
	if (RHIGetAvailableResolutions(Resolutions, true))
	{
		TSet<FIntVector> Seen;
		for (const FScreenResolutionRHI& R : Resolutions)
		{
			const FIntVector Key(R.Width, R.Height, R.RefreshRate);
			if (Seen.Contains(Key)) { continue; }
			Seen.Add(Key);
			Modes += FString::Printf(TEXT("%s{\"width\":%u,\"height\":%u,\"refresh\":%u}"), Modes.Len() > 1 ? TEXT(",") : TEXT(""), R.Width, R.Height, R.RefreshRate);
		}
	}
	Modes += TEXT("]");
	FString Current = TEXT("{}");
	if (UGameUserSettings* S = GEngine ? GEngine->GetGameUserSettings() : nullptr)
	{
		const FIntPoint Res = S->GetScreenResolution();
		const EWindowMode::Type Mode = S->GetFullscreenMode();
		Current = FString::Printf(TEXT("{\"width\":%d,\"height\":%d,\"mode\":\"%s\",\"vsync\":%s,\"maxFps\":%.0f}"), Res.X, Res.Y,
			Mode == EWindowMode::Fullscreen ? TEXT("fullscreen") : Mode == EWindowMode::WindowedFullscreen ? TEXT("borderless") : TEXT("windowed"),
			S->IsVSyncEnabled() ? TEXT("true") : TEXT("false"), S->GetFrameRateLimit());
	}
	FScopeLock Lock(&DisplayLock);
	DisplayModesJson = Modes;
	DisplayJson = Current;
}

void UJsgbBridge::DisplaySet(const FString& Json)
{
	RunOnGame([this, Json]
	{
		TSharedPtr<FJsonObject> In;
		FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), In);
		if (!In) { return; }
		ApplyDisplay(In);
		if (In->HasField(TEXT("maxFps"))) { bSavedFrameCap = true; }
		// Kept for this game only: merged into its display.json.
		if (!DisplayFile.IsEmpty())
		{
			FString Old;
			TSharedPtr<FJsonObject> Saved;
			if (FFileHelper::LoadFileToString(Old, *DisplayFile)) { FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Old), Saved); }
			if (!Saved) { Saved = MakeShared<FJsonObject>(); }
			for (const auto& F : In->Values) { Saved->SetField(F.Key, F.Value); }
			FString Out;
			FJsonSerializer::Serialize(Saved.ToSharedRef(), TJsonWriterFactory<>::Create(&Out));
			FFileHelper::SaveStringToFile(Out, *DisplayFile);
		}
		UpdateDisplayInfo();
		Log(TEXT("log"), TEXT("display: ") + DisplayGet());
	});
}

void UJsgbBridge::ApplyDisplay(const TSharedPtr<FJsonObject>& In)
{
	UGameUserSettings* S = GEngine ? GEngine->GetGameUserSettings() : nullptr;
	if (!In || !S) { return; }
	{
		double W = 0, H = 0, MaxFps = -1;
		FString Mode;
		bool bVsync = false;
		if (In->TryGetNumberField(TEXT("width"), W) && In->TryGetNumberField(TEXT("height"), H) && W > 0 && H > 0) { S->SetScreenResolution(FIntPoint(W, H)); }
		if (In->TryGetStringField(TEXT("mode"), Mode))
		{
			S->SetFullscreenMode(Mode == TEXT("fullscreen") ? EWindowMode::Fullscreen : Mode == TEXT("borderless") ? EWindowMode::WindowedFullscreen : EWindowMode::Windowed);
			// Borderless covers the whole monitor at its own resolution.
			if (Mode == TEXT("borderless")) { S->SetScreenResolution(S->GetDesktopResolution()); }
		}
		if (In->TryGetBoolField(TEXT("vsync"), bVsync)) { S->SetVSyncEnabled(bVsync); }
		if (In->TryGetNumberField(TEXT("maxFps"), MaxFps) && MaxFps >= 0) { S->SetFrameRateLimit(MaxFps); }
		// Applied without SaveSettings: Unreal's settings file is shared by every game in this host.
		S->ApplyResolutionSettings(false);
		S->ApplyNonResolutionSettings();
	}
}

FString UJsgbBridge::GraphicsGet() { FScopeLock Lock(&DisplayLock); return GraphicsJson; }
void UJsgbBridge::SetGraphicsInfo(const FString& Json) { FScopeLock Lock(&DisplayLock); GraphicsJson = Json; }

void UJsgbBridge::GraphicsSet(const FString& Json)
{
	RunOnGame([this, Json]
	{
		TSharedPtr<FJsonObject> In;
		FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), In);
		if (In && OnGraphicsSet) { OnGraphicsSet(In); }
	});
}

void UJsgbBridge::RestoreDisplay()
{
	if (UGameUserSettings* S = GEngine ? GEngine->GetGameUserSettings() : nullptr)
	{
		// An earlier build saved a frame cap there for every game; each game starts uncapped unless it saved its own.
		if (S->GetFrameRateLimit() > 0) { S->SetFrameRateLimit(0); S->ApplyNonResolutionSettings(); S->SaveSettings(); }
	}
	FString Saved;
	TSharedPtr<FJsonObject> In;
	if (!DisplayFile.IsEmpty() && FFileHelper::LoadFileToString(Saved, *DisplayFile) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Saved), In) && In)
	{
		ApplyDisplay(In);
		bSavedFrameCap = In->HasField(TEXT("maxFps"));
		Log(TEXT("log"), TEXT("display settings restored: ") + Saved);
	}
	UpdateDisplayInfo();
}
