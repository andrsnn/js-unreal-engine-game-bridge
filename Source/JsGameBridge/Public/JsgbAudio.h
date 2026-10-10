#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
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
	void SetFileAssets(const TMap<FString, FString>& Files) { FileAssets = Files; }
	void StopAll();

	UPROPERTY() TObjectPtr<UJsgbBridge> Bridge;
	float MasterGain = 1.f;
	int32 ActiveVoices() const { return Voices.Num(); }
	int32 StartedVoices = 0, UnplayableVoices = 0;

	struct FPcm { TArray<int16> Samples; int32 Channels = 1; int32 SampleRate = 48000; };

private:
	TSharedPtr<FPcm> Decode(const FString& Path);
	UAudioComponent* Start(int32 Id, const TSharedPtr<class FJsonObject>& Op);
	void Update(UAudioComponent* C, const TSharedPtr<class FJsonObject>& Op);

	TMap<FString, TSharedPtr<FPcm>> Decoded;
	TMap<int32, TSharedPtr<FPcm>> Synthesized;
	TMap<FString, FString> FileAssets;
	UPROPERTY() TMap<int32, TObjectPtr<UAudioComponent>> Voices;
	UPROPERTY() TMap<FString, TObjectPtr<USoundBase>> Assets;
};
