#include "JsgbBridge.h"
#include "JsgbSceneMirror.h"
#include "JsgbAudio.h"
#include "HAL/PlatformTime.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"
#include "Async/Async.h"
THIRD_PARTY_INCLUDES_START
#include "ft2build.h"
#include FT_FREETYPE_H
THIRD_PARTY_INCLUDES_END

DEFINE_LOG_CATEGORY_STATIC(LogJsgb, Log, All);

FArrayBufferValue UJsgbBridge::ReadFile(const FString& Path)
{
	FArrayBufferValue Out;
	FString Rel = Path;
	Rel.ReplaceInline(TEXT("\\"), TEXT("/"));
	while (Rel.StartsWith(TEXT("/"))) { Rel.RightChopInline(1); }
	if (Rel.Contains(TEXT("..")) || Rel.Contains(TEXT(":"))) { return Out; }
	for (const FString& Root : PublicRoots)
	{
		const FString Full = Root / Rel;
		if (FPaths::FileExists(Full) && FFileHelper::LoadFileToArray(Out.Data, *Full, FILEREAD_Silent)) { return Out; }
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

FArrayBufferValue UJsgbBridge::CacheGet(const FString& Key)
{
	FArrayBufferValue Out;
	if (const TArray<uint8>* Found = GJsgbCache.Find(Key)) { Out.Data = *Found; return Out; }
	TArray<uint8> Disk;
	if (FFileHelper::LoadFileToArray(Disk, *CacheFile(Key), FILEREAD_Silent) && Disk.Num() > 0) { Out.Data = Remember(Key, MoveTemp(Disk)); }
	return Out;
}

void UJsgbBridge::CachePut(const FString& Key, FArrayBuffer Bytes)
{
	if (!Bytes.Data || Bytes.Length <= 0) { return; }
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
	bReady = true;
	Log(TEXT("log"), TEXT("js ready ") + Info);
}

void UJsgbBridge::Geometry(int32 Id, FArrayBuffer Positions, FArrayBuffer Normals, FArrayBuffer UVs, FArrayBuffer Colors, int32 ColorSize, FArrayBuffer Indices, const FString& Groups)
{
	if (Mirror) { Mirror->SetGeometry(Id, Positions, Normals, UVs, Colors, ColorSize, Indices, Groups); }
}

void UJsgbBridge::ReleaseGeometry(int32 Id) { if (Mirror) { Mirror->ReleaseGeometry(Id); } }
void UJsgbBridge::Material(int32 Id, const FString& Json) { if (Mirror) { Mirror->SetMaterial(Id, Json); } }
void UJsgbBridge::Texture(int32 Id, const FString& Json, FArrayBuffer Bytes) { if (Mirror) { Mirror->SetTexture(Id, Json, Bytes); } }
void UJsgbBridge::Events(const FString& Json) { if (Mirror) { Mirror->ApplyEvents(Json); } }
void UJsgbBridge::Shader(const FString& Key, const FString& Json) { if (Mirror) { Mirror->SetShader(Key, Json); } }

void UJsgbBridge::Frame(FArrayBuffer Floats, int32 Count, FArrayBuffer Instances, int32 InstanceFloats)
{
	if (!Mirror) { return; }
	++SceneFrames;
	const int32 Available = static_cast<int32>(Floats.Length / sizeof(float));
	const int32 InstAvailable = static_cast<int32>(Instances.Length / sizeof(float));
	Mirror->ApplyFrame(static_cast<const float*>(Floats.Data), FMath::Clamp(Count, 0, Available),
		static_cast<const float*>(Instances.Data), FMath::Clamp(InstanceFloats, 0, InstAvailable));
}

void UJsgbBridge::PublishUI(const FString& Html)
{
	UIHtml = Html;
	++UIVersion;
}

void UJsgbBridge::AudioVoices(const FString& Json) { if (Audio) { Audio->ApplyVoices(Json); } }

void UJsgbBridge::AudioPcm(int32 Id, FArrayBuffer Samples, int32 SampleRate)
{
	if (Audio && Samples.Data) { Audio->SetPcm(Id, static_cast<const float*>(Samples.Data), static_cast<int32>(Samples.Length / sizeof(float)), SampleRate); }
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
