#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Engine/StreamableManager.h"
#include <atomic>
#include "JsgbAudio.generated.h"

class UAudioComponent;
class USoundBase;
class UJsgbBridge;

/** Plays the web game's WebAudio voices (Runtime/src/audio.ts) in Unreal. A voice names a file
 *  from the web build, or carries PCM the game synthesized. Files with an imported Unreal sound
 *  in the registry play that asset; others are decoded at run time (Ogg Vorbis, WAV). Gain, pitch,
 *  position and low-pass follow the game's graph every frame. */
UCLASS()
class JSGAMEBRIDGE_API UJsgbAudio : public UActorComponent
{
	GENERATED_BODY()
public:
	UJsgbAudio();
	void ApplyVoices(const FString& Json);
	void SetPcm(int32 Id, const float* Samples, int32 Count, int32 SampleRate);
	/** Registry "files" map: site path ("/audio/x.ogg") -> Unreal sound asset path. */
	void SetFileAssets(const TMap<FString, FString>& Files);
	/** Starts decoding a sound file in the background. Safe on any thread. */
	void Preload(const FString& Path);
	/** Starts the voices that were waiting for their file to decode or load. */
	void StartPending();
	void StopAll();

	UPROPERTY() TObjectPtr<UJsgbBridge> Bridge;
	float MasterGain = 1.f;
	int32 ActiveVoices() const { return Voices.Num(); }
	int32 StartedVoices = 0, UnplayableVoices = 0;

	struct FPcm { TArray<int16> Samples; int32 Channels = 1; int32 SampleRate = 48000; };

private:
	/** A file's decode, run on the thread pool. Pcm is set before bDone. */
	struct FDecode { TSharedPtr<FPcm> Pcm; std::atomic<bool> bDone{false}; };
	TSharedPtr<FDecode> DecodeOf(const FString& Path);
	/** Starts a voice. Returns false while its file is still decoding or loading. */
	bool Start(int32 Id, const TSharedPtr<class FJsonObject>& Op);
	void Update(UAudioComponent* C, const TSharedPtr<class FJsonObject>& Op);

	FCriticalSection DecodeLock;
	TMap<FString, TSharedPtr<FDecode>> Decodes;
	TMap<int32, TSharedPtr<class FJsonObject>> Pending;
	FStreamableManager Streamable;
	TSharedPtr<struct FStreamableHandle> AssetLoad;
	TMap<int32, TSharedPtr<FPcm>> Synthesized;
	TMap<FString, FString> FileAssets;
	UPROPERTY() TMap<int32, TObjectPtr<UAudioComponent>> Voices;
	UPROPERTY() TMap<FString, TObjectPtr<USoundBase>> Assets;
};
