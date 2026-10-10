#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "ArrayBuffer.h"
#include "JsgbBridge.generated.h"

class UJsgbSceneMirror;
class UJsgbAudio;

DECLARE_DYNAMIC_DELEGATE_OneParam(FJsgbFrameDelegate, float, BudgetMs);
DECLARE_DYNAMIC_DELEGATE_OneParam(FJsgbStringDelegate, const FString&, Json);
DECLARE_DYNAMIC_DELEGATE_ThreeParams(FJsgbKeyDelegate, const FString&, Type, const FString&, Code, bool, bRepeat);
DECLARE_DYNAMIC_DELEGATE_SevenParams(FJsgbMouseDelegate, const FString&, Type, float, X, float, Y, int32, Button, int32, Buttons, float, DX, float, DY);
DECLARE_DYNAMIC_DELEGATE_OneParam(FJsgbWheelDelegate, float, DeltaY);
DECLARE_DYNAMIC_DELEGATE_TwoParams(FJsgbViewportDelegate, int32, Width, int32, Height);
DECLARE_DYNAMIC_DELEGATE_RetVal_OneParam(FString, FJsgbEvalDelegate, const FString&, Source);

/** The object the bundled web game talks to through `globalThis.__jsgbHost` (see
 *  JavaScript/jsgb-main.js): files, time, logs, saves, the scene sink, the UI snapshot and audio.
 *  No game rules live here. */
UCLASS()
class JSGAMEBRIDGE_API UJsgbBridge : public UObject
{
	GENERATED_BODY()
public:
	// Bound from JavaScript.
	UPROPERTY() FJsgbFrameDelegate OnFrame;
	UPROPERTY() FJsgbStringDelegate OnUIInput;
	UPROPERTY() FJsgbKeyDelegate OnKey;
	UPROPERTY() FJsgbMouseDelegate OnMouse;
	UPROPERTY() FJsgbWheelDelegate OnWheel;
	UPROPERTY() FJsgbViewportDelegate OnViewport;
	UPROPERTY() FJsgbStringDelegate OnGamepads;
	UPROPERTY() FJsgbEvalDelegate OnEval;

	/** location.search the game boots with (e.g. "?play"). */
	UPROPERTY() FString Search;
	/** -JsgbTraceMirror: the runtime logs each object's type, name and uuid the first time it is drawn. */
	UPROPERTY() bool Trace = false;
	/** The merged asset registry JSON the build wrote. */
	UPROPERTY() FString Registry;
	/** Math.random seed for deterministic captures (-JsgbSeed=); 0 keeps it random. */
	UPROPERTY() int32 Seed = 0;
	/** Absolute path of the bundle (.mjs). */
	UPROPERTY() FString BundlePath;

	// Platform services.
	UFUNCTION() FArrayBufferValue ReadFile(const FString& Path);
	UFUNCTION() double NowMs() const;
	UFUNCTION() void Log(const FString& Level, const FString& Text);
	UFUNCTION() void RequestReload();
	UFUNCTION() FString LoadStore(const FString& Key);
	UFUNCTION() void SaveStore(const FString& Key, const FString& Data);
	UFUNCTION() void JsReady(const FString& Info);
	/** Bytes kept for the life of the Unreal process, so a hot reload can reuse earlier work (worker results). */
	UFUNCTION() FArrayBufferValue CacheGet(const FString& Key);
	UFUNCTION() void CachePut(const FString& Key, FArrayBuffer Bytes);
	/** Canvas text: glyph coverage for one run of text. Returns five floats (width, height, ascent,
	 *  descent, advance) followed by width*height alpha bytes; empty when the font cannot load. */
	UFUNCTION() FArrayBufferValue Text(const FString& FontPath, float SizePx, const FString& Run);

	// Scene sink (Runtime/src/sceneExport.ts describes the layout).
	UFUNCTION() void Geometry(int32 Id, FArrayBuffer Positions, FArrayBuffer Normals, FArrayBuffer UVs, FArrayBuffer Colors, int32 ColorSize, FArrayBuffer Indices, const FString& Groups);
	UFUNCTION() void ReleaseGeometry(int32 Id);
	UFUNCTION() void Material(int32 Id, const FString& Json);
	UFUNCTION() void Texture(int32 Id, const FString& Json, FArrayBuffer Bytes);
	UFUNCTION() void Frame(FArrayBuffer Floats, int32 Count, FArrayBuffer Instances, int32 InstanceFloats);
	UFUNCTION() void Events(const FString& Json);
	UFUNCTION() void Shader(const FString& Key, const FString& Json);

	// DOM UI and audio.
	UFUNCTION() void PublishUI(const FString& Html);
	UFUNCTION() void AudioVoices(const FString& Json);
	UFUNCTION() void AudioPcm(int32 Id, FArrayBuffer Samples, int32 SampleRate);

	TArray<FString> PublicRoots;
	FString StoreDir;
	FString LogPath;
	double StartSeconds = 0;
	/** When > 0, the game clock advances this many ms per host tick (deterministic captures). */
	double FixedStepMs = 0;
	double VirtualMs = 0;
	bool bReloadRequested = false;
	bool bReady = false;
	int32 ErrorCount = 0;
	int32 Generation = 0;
	FString UIHtml;
	int64 UIVersion = 0;
	int64 SceneFrames = 0;
	UPROPERTY() TObjectPtr<UJsgbSceneMirror> Mirror;
	UPROPERTY() TObjectPtr<UJsgbAudio> Audio;
};
