#include "JsgbBridge.h"
#include "JsgbSceneMirror.h"
#include "JsgbAudio.h"
#include "HAL/PlatformTime.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"

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
	return FixedStepMs > 0 ? VirtualMs : (FPlatformTime::Seconds() - StartSeconds) * 1000.0;
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
