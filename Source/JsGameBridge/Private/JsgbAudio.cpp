#include "JsgbAudio.h"
#include "JsgbBridge.h"
#include "Components/AudioComponent.h"
#include "Sound/SoundWaveProcedural.h"
#include "Sound/SoundAttenuation.h"
#include "Interfaces/IAudioFormat.h"
#include "Decoders/VorbisAudioInfo.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Async/Async.h"

DEFINE_LOG_CATEGORY_STATIC(LogJsgbAudio, Log, All);

namespace
{
	constexpr float Cm = 100.f;
	double Num(const TSharedPtr<FJsonObject>& O, const TCHAR* Key, double Default = 0) { double V = Default; return O && O->TryGetNumberField(Key, V) ? V : Default; }

	/** 16-bit or float PCM from a RIFF WAVE file. */
	bool DecodeWav(const TArray<uint8>& B, UJsgbAudio::FPcm& Out)
	{
		if (B.Num() < 44 || FMemory::Memcmp(B.GetData(), "RIFF", 4) || FMemory::Memcmp(B.GetData() + 8, "WAVE", 4)) { return false; }
		int32 O = 12, Format = 0, Bits = 0;
		while (O + 8 <= B.Num())
		{
			const uint32 Len = *reinterpret_cast<const uint32*>(B.GetData() + O + 4);
			if (!FMemory::Memcmp(B.GetData() + O, "fmt ", 4))
			{
				Format = *reinterpret_cast<const uint16*>(B.GetData() + O + 8);
				Out.Channels = *reinterpret_cast<const uint16*>(B.GetData() + O + 10);
				Out.SampleRate = *reinterpret_cast<const uint32*>(B.GetData() + O + 12);
				Bits = *reinterpret_cast<const uint16*>(B.GetData() + O + 22);
			}
			else if (!FMemory::Memcmp(B.GetData() + O, "data", 4) && Out.Channels > 0)
			{
				const uint8* D = B.GetData() + O + 8;
				const int64 Bytes = FMath::Min<int64>(Len, B.Num() - O - 8);
				if (Format == 1 && Bits == 16) { Out.Samples.SetNumUninitialized(Bytes / 2); FMemory::Memcpy(Out.Samples.GetData(), D, Out.Samples.Num() * 2); return true; }
				if (Format == 3 && Bits == 32) { const int64 N = Bytes / 4; Out.Samples.SetNumUninitialized(N); for (int64 I = 0; I < N; ++I) { Out.Samples[I] = static_cast<int16>(FMath::Clamp(reinterpret_cast<const float*>(D)[I], -1.f, 1.f) * 32767.f); } return true; }
				if (Format == 1 && Bits == 8) { Out.Samples.SetNumUninitialized(Bytes); for (int64 I = 0; I < Bytes; ++I) { Out.Samples[I] = (static_cast<int16>(D[I]) - 128) << 8; } return true; }
				return false;
			}
			O += 8 + Len + (Len & 1);
		}
		return false;
	}
}

UJsgbAudio::UJsgbAudio()
{
	PrimaryComponentTick.bCanEverTick = false;
}

namespace
{
	/** PCM from a WAV or Ogg Vorbis file, or null. Safe on any thread. */
	TSharedPtr<UJsgbAudio::FPcm> DecodeFile(const TArray<uint8>& File)
	{
		if (File.Num() == 0) { return nullptr; }
		TSharedPtr<UJsgbAudio::FPcm> P = MakeShared<UJsgbAudio::FPcm>();
		if (DecodeWav(File, *P)) { return P; }
		if (File.Num() > 4 && !FMemory::Memcmp(File.GetData(), "OggS", 4))
		{
#if WITH_OGGVORBIS
			LoadVorbisLibraries();
			FVorbisAudioInfo Vorbis;
			FSoundQualityInfo Info;
			if (Vorbis.ReadCompressedInfo(File.GetData(), File.Num(), &Info) && Info.SampleDataSize > 0)
			{
				P->Channels = Info.NumChannels;
				P->SampleRate = Info.SampleRate;
				P->Samples.SetNumZeroed(Info.SampleDataSize / 2);
				Vorbis.ExpandFile(reinterpret_cast<uint8*>(P->Samples.GetData()), &Info);
				return P;
			}
#endif
		}
		return nullptr;
	}
}

void UJsgbAudio::SetFileAssets(const TMap<FString, FString>& Files)
{
	FileAssets = Files;
	// The imported Unreal sounds load in the background now, so playing one never waits for the disk.
	TArray<FSoftObjectPath> Paths;
	for (const TPair<FString, FString>& F : Files) { Paths.AddUnique(FSoftObjectPath(F.Value)); }
	AssetLoad = Paths.Num() ? Streamable.RequestAsyncLoad(Paths, FStreamableDelegate(), FStreamableManager::AsyncLoadHighPriority) : nullptr;
}

TSharedPtr<UJsgbAudio::FDecode> UJsgbAudio::DecodeOf(const FString& Path)
{
	{
		FScopeLock Lock(&DecodeLock);
		if (const TSharedPtr<FDecode>* Found = Decodes.Find(Path)) { return *Found; }
	}
	// Decoding a long Ogg file takes hundreds of milliseconds, so it runs on the thread pool.
	TArray<uint8> File = Bridge ? Bridge->ReadFile(Path).Data : TArray<uint8>();
	TSharedPtr<FDecode> D = MakeShared<FDecode>();
	{
		FScopeLock Lock(&DecodeLock);
		if (const TSharedPtr<FDecode>* Found = Decodes.Find(Path)) { return *Found; }
		Decodes.Add(Path, D);
	}
	Async(EAsyncExecution::ThreadPool, [D, Path, File = MoveTemp(File)]
	{
		D->Pcm = DecodeFile(File);
		if (!D->Pcm) { UE_LOG(LogJsgbAudio, Warning, TEXT("Cannot play %s (missing, or not Ogg Vorbis/WAV)"), *Path); }
		D->bDone = true;
	});
	return D;
}

void UJsgbAudio::Preload(const FString& Path)
{
	if (!Path.IsEmpty() && !FileAssets.Contains(Path)) { DecodeOf(Path); }
}

void UJsgbAudio::SetPcm(int32 Id, const float* Samples, int32 Count, int32 SampleRate)
{
	TSharedPtr<FPcm> P = MakeShared<FPcm>();
	P->Channels = 1;
	P->SampleRate = FMath::Clamp(SampleRate, 8000, 192000);
	P->Samples.SetNumUninitialized(Count);
	for (int32 I = 0; I < Count; ++I) { P->Samples[I] = static_cast<int16>(FMath::Clamp(Samples[I], -1.f, 1.f) * 32767.f); }
	Synthesized.Add(Id, P);
}

bool UJsgbAudio::Start(int32 Id, const TSharedPtr<FJsonObject>& Op)
{
	const bool bLoop = Op->GetBoolField(TEXT("loop"));
	const double Offset = Num(Op, TEXT("offset"));
	USoundBase* Sound = nullptr;
	TSharedPtr<FPcm> Pcm;
	FString Src;
	if (Op->TryGetStringField(TEXT("src"), Src))
	{
		// An imported Unreal sound for this file wins; otherwise decode the web file.
		if (const FString* AssetPath = FileAssets.Find(Src))
		{
			TObjectPtr<USoundBase>& Cached = Assets.FindOrAdd(*AssetPath);
			if (!Cached)
			{
				// Still loading in the background: the voice starts when the sound arrives.
				if (AssetLoad.IsValid() && AssetLoad->IsLoadingInProgress() && !FSoftObjectPath(*AssetPath).ResolveObject()) { return false; }
				Cached = LoadObject<USoundBase>(nullptr, **AssetPath, nullptr, LOAD_NoWarn | LOAD_Quiet);
			}
			Sound = Cached;
		}
		if (!Sound)
		{
			const TSharedPtr<FDecode> D = DecodeOf(Src);
			if (!D->bDone) { return false; }
			Pcm = D->Pcm;
		}
	}
	else { Synthesized.RemoveAndCopyValue(Id, Pcm); }
	if (!Sound && Pcm && Pcm->Samples.Num() > 0)
	{
		USoundWaveProcedural* Wave = NewObject<USoundWaveProcedural>(this);
		Wave->SetSampleRate(Pcm->SampleRate);
		Wave->NumChannels = Pcm->Channels;
		Wave->Duration = bLoop ? INDEFINITELY_LOOPING_DURATION : Pcm->Samples.Num() / static_cast<float>(Pcm->Channels * Pcm->SampleRate);
		Wave->SoundGroup = SOUNDGROUP_Default;
		Wave->bLooping = false;
		const int64 Frames = Pcm->Samples.Num() / FMath::Max(1, Pcm->Channels);
		const int64 Start = FMath::Clamp<int64>(static_cast<int64>(Offset * Pcm->SampleRate), 0, FMath::Max<int64>(0, Frames - 1)) * Pcm->Channels;
		Wave->QueueAudio(reinterpret_cast<const uint8*>(Pcm->Samples.GetData() + Start), (Pcm->Samples.Num() - Start) * 2);
		if (bLoop)
		{
			// Keep a whole loop queued ahead; the callback runs on the audio render thread.
			TSharedPtr<FPcm> Shared = Pcm;
			Wave->OnSoundWaveProceduralUnderflow.BindLambda([Shared](USoundWaveProcedural* W, int32 SamplesNeeded)
			{
				W->QueueAudio(reinterpret_cast<const uint8*>(Shared->Samples.GetData()), Shared->Samples.Num() * 2);
			});
		}
		Sound = Wave;
	}
	if (!Sound) { ++UnplayableVoices; return true; }
	UAudioComponent* C = NewObject<UAudioComponent>(GetOwner());
	C->bAutoDestroy = !bLoop;
	C->bAllowSpatialization = false;
	C->SetSound(Sound);
	C->RegisterComponent();
	Update(C, Op);
	C->Play(Sound->IsA<USoundWaveProcedural>() ? 0.f : Offset);
	++StartedVoices;
	Voices.Add(Id, C);
	return true;
}

void UJsgbAudio::Update(UAudioComponent* C, const TSharedPtr<FJsonObject>& Op)
{
	C->SetVolumeMultiplier(FMath::Max(0.0, Num(Op, TEXT("gain"), 1)) * MasterGain);
	C->SetPitchMultiplier(FMath::Clamp(Num(Op, TEXT("rate"), 1), 0.125, 8.0));
	const double LowPass = Num(Op, TEXT("lowpass"), 22050);
	C->SetLowPassFilterEnabled(LowPass < 20000);
	if (LowPass < 20000) { C->SetLowPassFilterFrequency(LowPass); }
	const TArray<TSharedPtr<FJsonValue>>* P = nullptr;
	if (Op->TryGetArrayField(TEXT("position"), P) && P->Num() == 3)
	{
		C->bAllowSpatialization = true;
		C->bOverrideAttenuation = true;
		FSoundAttenuationSettings& A = C->AttenuationOverrides;
		A.bAttenuate = true;
		A.bSpatialize = true;
		A.DistanceAlgorithm = EAttenuationDistanceModel::Inverse;
		A.AttenuationShape = EAttenuationShape::Sphere;
		A.AttenuationShapeExtents = FVector(FMath::Max(1.0, Num(Op, TEXT("refDistance"), 1)) * Cm, 0, 0);
		A.FalloffDistance = FMath::Max(1.0, Num(Op, TEXT("maxDistance"), 10000)) * Cm;
		C->SetWorldLocation(FVector((*P)[0]->AsNumber() * Cm, (*P)[2]->AsNumber() * Cm, (*P)[1]->AsNumber() * Cm));
	}
}

void UJsgbAudio::ApplyVoices(const FString& Json)
{
	TArray<TSharedPtr<FJsonValue>> Ops;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Ops)) { return; }
	for (const TSharedPtr<FJsonValue>& V : Ops)
	{
		const TSharedPtr<FJsonObject> Op = V->AsObject();
		if (!Op) { continue; }
		FString Kind; Op->TryGetStringField(TEXT("op"), Kind);
		const int32 Id = static_cast<int32>(Num(Op, TEXT("id")));
		if (Kind == TEXT("start")) { if (!Start(Id, Op)) { Pending.Add(Id, Op); } }
		else if (Kind == TEXT("update"))
		{
			if (UAudioComponent* C = Voices.FindRef(Id)) { Update(C, Op); }
			// A waiting voice starts with the latest gain, rate and position.
			else if (const TSharedPtr<FJsonObject>* P = Pending.Find(Id)) { for (const auto& F : Op->Values) { if (F.Key != TEXT("op")) { (*P)->SetField(F.Key, F.Value); } } }
		}
		else if (Kind == TEXT("stop")) { if (UAudioComponent* C = Voices.FindRef(Id)) { C->Stop(); C->DestroyComponent(); } Voices.Remove(Id); Pending.Remove(Id); }
	}
	// Forget one-shots that finished on their own.
	for (auto It = Voices.CreateIterator(); It; ++It) { if (!It.Value() || !IsValid(It.Value()) || !It.Value()->IsPlaying()) { It.RemoveCurrent(); } }
}

void UJsgbAudio::StartPending()
{
	for (auto It = Pending.CreateIterator(); It; ++It) { if (Start(It.Key(), It.Value())) { It.RemoveCurrent(); } }
}

void UJsgbAudio::StopAll()
{
	Pending.Reset();
	for (TPair<int32, TObjectPtr<UAudioComponent>>& V : Voices) { if (V.Value) { V.Value->Stop(); V.Value->DestroyComponent(); } }
	Voices.Reset();
	Synthesized.Reset();
}
