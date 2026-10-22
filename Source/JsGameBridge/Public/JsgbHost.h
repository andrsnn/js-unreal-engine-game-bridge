#pragma once

#include "CoreMinimal.h"
#include <atomic>
#include "GameFramework/Actor.h"
#include "GameFramework/GameModeBase.h"
#include "Engine/Scene.h"
#include "PuertsNamespaceDef.h"
#include "JsgbHost.generated.h"

class UJsgbBridge;
class UJsgbSceneMirror;
class UJsgbAudio;
class UCameraComponent;
class SWebBrowser;
class IHttpRouter;
namespace PUERTS_NAMESPACE { class FJsEnv; }

/** What the CEF overlay calls (window.ue.jsgb.sendinput): DOM events and layout from the mirrored UI. */
/** What a page game (one running in the built-in browser) can call through window.ue.jsgbpage: the display settings
 *  behind window.jsgb.display. */
UCLASS()
class JSGAMEBRIDGE_API UJsgbPagePort : public UObject
{
	GENERATED_BODY()
public:
	UPROPERTY() TObjectPtr<class UJsgbBridge> Display;
	/** The page's frame rate, which Unreal's frame rate is held to. */
	int32 PageFps = 60;
	/** Unreal's frame cap the page asked for (window.jsgb.display), at most PageFps. */
	float Cap = 60.f;
	UFUNCTION() FString DisplayModes();
	UFUNCTION() FString DisplayGet();
	UFUNCTION() void DisplaySet(const FString& Json);
	/** window.close() in the page: closes the game, as closing a browser tab would. */
	UFUNCTION() void Quit();
	/** A Web Audio context in the page is running (it started after a user gesture). */
	UFUNCTION() void AudioRunning() { bAudioRunning = true; }
	bool bAudioRunning = false;
};

UCLASS()
class JSGAMEBRIDGE_API UJsgbUIPort : public UObject
{
	GENERATED_BODY()
public:
	UFUNCTION() void SendInput(const FString& Json);
	UPROPERTY() TObjectPtr<UJsgbBridge> Bridge;
	int32 LayoutMessages = 0;
	/** The UI version the overlay last reported as applied (from its layout reports). */
	int32 AppliedUIVersion = -1;
	/** The page CSS version the overlay last painted (POST /bridge/css). */
	int32 AppliedCssVersion = -1;
	FString LastLayoutSize;
};

/** One timed step of a host script (-JsgbScript=file): "<seconds|@frame> <verb> <args>". */
struct FJsgbScriptStep
{
	double Time = 0;
	int32 Frame = 0;
	bool bAbsolute = false;
	FString Verb;
	FString Args;
};

/** Runs an unchanged browser game, built by Tools/jsgb.mjs, inside Unreal: Puerts runs the bundle
 *  and its browser environment, the scene mirror draws its Three.js scene, a transparent CEF
 *  overlay shows and operates its DOM UI, and WebAudio plays through Unreal audio. The game
 *  folder comes from -JsgbGame=<build dir>. A new bundle hot-reloads through POST /bridge/reload.
 *  No game rules live here. */
UCLASS()
class JSGAMEBRIDGE_API AJsgbHost : public AActor
{
	GENERATED_BODY()
public:
	AJsgbHost();
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void Tick(float DeltaSeconds) override;

	void SendKey(const FString& Type, const FString& Code, bool bRepeat);
	/** F6 and F7 with -JsgbDlssKeys: switch the DLSS mode or Frame Generation. True when the key was used. */
	bool HandleDlssKey(const FKey& Key);
	void SendMouse(const FString& Type, float X, float Y, int32 Button, int32 Buttons, float DX, float DY);
	void SendWheel(float DeltaY);
	void SendGamepads(const FString& Json);
	void SendGamepadsToJs(const FString& Json);
	FString Eval(const FString& Source);
	/** An answer from the game's JavaScript that arrives later; Text is set before bDone. */
	struct FAnswer { FString Text; std::atomic<bool> bDone{false}; };
	/** Runs Source in the game's JavaScript without waiting for it. */
	TSharedRef<FAnswer> Ask(const FString& Source);
	bool HasOverlay() const { return Browser.IsValid(); }
	/** A page game (pixi.js and the like) runs in the built-in browser; the host feeds it gamepads through the page. */
	bool IsPageGame() const { return !PageIndex.IsEmpty(); }
	/** A gamepad button went down: until the page's Web Audio runs, give the page a real key press (F24) as the user
	 *  gesture Chromium needs to start sound. A gamepad press is not one. */
	void PagePadGesture();
	bool IsRecording() const { return !RecordDir.IsEmpty(); }

	UPROPERTY() TObjectPtr<UJsgbBridge> Bridge;
	UPROPERTY() TObjectPtr<UJsgbSceneMirror> Mirror;
	UPROPERTY() TObjectPtr<UJsgbAudio> Audio;
	UPROPERTY() TObjectPtr<UCameraComponent> Camera;
	UPROPERTY() TObjectPtr<UJsgbUIPort> UIPort;

	FString GameDir, BundlePath, SourceCommit, BundleSHA256, Title;
	int32 Port = 5292;

private:
	bool LoadPublication(const FString& Dir, const FString& OverrideBundle);
	void StartJs();
	void StopJs();
	void StartServer();
	void CreateOverlay();
	void PushUI();
	void Capture(const FString& Path);
	void LoadScript(const FString& Path);
	void RunScript();
	void ShowReloadBanner(const FString& Text);
	void SwapCss(double BuildMs);
	void SetupUpscaler();
	/** Lumen mode: Unreal's own lighting, the override models and Unreal effects, on and off while the game runs
	 *  (F9, window.jsgb.graphics); -JsgbLumen[=high|light] starts with it on (JsgbFidelity.cpp). */
	void SetupLumen();
	void SetLumen(bool bOn);
	/** Tells the game's JavaScript whether Lumen mode is on, and takes its changes. */
	void PublishGraphics();
	UPROPERTY() TObjectPtr<class USkyLightComponent> LumenSky;
	UPROPERTY() TObjectPtr<class UExponentialHeightFogComponent> LumenFog;
	FString LumenPreset;
	bool bLumenOn = false, bLumenAvailable = false;
	TMap<FString, FString> LumenSaved;
	bool SavedGiOverride = false, SavedReflectionOverride = false;
	EDynamicGlobalIlluminationMethod::Type SavedGi = EDynamicGlobalIlluminationMethod::None;
	EReflectionMethod::Type SavedReflection = EReflectionMethod::None;
	void ApplyUpscaler(const FString& Mode, const FString& TsrPercent);
	/** F6: the next DLSS mode (off, DLAA, Quality, Balanced, Performance, DLSS 5). F7: Frame Generation off, 2x, and on RTX 50
	 *  GPUs 3x and 4x (Multi Frame Generation). */
	void CycleUpscaler();
	void ToggleFrameGen();
	/** Page mode: the game's own web build runs in the built-in browser (for 2D WebGL games such as pixi.js ones). */
	void CreatePageView();
	/** Whether DLSS 5 Neural Rendering can run here; when it can't, why (for the log) and the short form (for the readout). */
	bool NeuralRenderingCheck(FString& Why, FString& Short) const;
	void UpdateHud(float DeltaSeconds);
	TSharedRef<SWidget> MakeJitterGraph();
	void StartRecording(const FString& Dir, double Fps);
	void StopRecording();
	void OnRecordedFrame(int32 Width, int32 Height, const TArray<FColor>& Bitmap);
	void SaveRecordedFrame(TArray<FColor>&& Pixels, int32 Width, int32 Height, int64 UnixMs);
	void TakeGrabbedFrames();
	double GameSeconds() const;

	TSharedPtr<PUERTS_NAMESPACE::FJsEnv> JsEnv;
	TSharedPtr<class FJsgbJsThread> JsThread;
	double LastSnapshot = 0, SnapshotInterval = 1.0 / 60.0;
	/** The glide between game updates: from the pose on screen when an update arrived (at SegmentStart) to the update's
	 *  pose at SegmentEnd, which is the time the JavaScript thread made it plus one game interval and one Unreal frame. */
	double SegmentStart = 0, SegmentEnd = 0, LastProduced = 0, DrawInterval = 1.0 / 60.0;
	/** How evenly the camera moves: its speed each frame while it moves, summed for the frame log. */
	FVector LastCameraAt = FVector::ZeroVector;
	/** Key-to-camera probe (POST /bridge/key "down ..."): when the key came, the camera then, and the last result in ms (-1: no move in 2 s). */
	double KeyProbeAt = 0, KeyToCameraMs = 0;
	FTransform KeyProbeFrom;
	double CamSpeedSum = 0, CamSpeedSum2 = 0;
	int32 CamSpeedFrames = 0;
	TSharedPtr<SWebBrowser> Browser;
	/** The page game's browser window (a child window of the game window, or off screen with -JsgbPageOsr). */
	TSharedPtr<class IWebBrowserWindow> PageWindow;
	UPROPERTY() TObjectPtr<UJsgbPagePort> PagePort;
	TSharedPtr<IHttpRouter> Router;
	FDelegateHandle RouteHandle;
	TSharedPtr<class FJsgbInputProcessor> Input;
	TArray<FString> PublicRoots;
	FString Search, RegistryJson, PageCss;
	/** The web build's page, relative to the first public root, when publication.json has "page"; empty otherwise. */
	FString PageIndex;
	bool bDocumentReady = false;
	/** When the page last fetched a file from the host. Unreal ticks faster while it does: the HTTP server and Chromium's
	 *  browser thread both run on Unreal's game thread, once per frame. */
	double LastPageFile = 0;
	float PageLoadFps = 0.f;
	/** The last gamepad state sent, sent again to a page that reloads. */
	FString LastPadJson;
	/** Handheld preset (-JsgbHandheld, or no NVIDIA GPU): no Lumen, no DLSS or frame generation, TSR at a lower render scale, 60 FPS cap. */
	bool bHandheld = false;
	void ApplyHandheld();
	int64 PushedUIVersion = -1;
	bool bRestart = false;
	FString PendingBundle;
	int64 Frame = 0, ExitFrame = -1, ReadyFrame = -1;
	double ReadySeconds = 0;
	double MaxSeconds = 0, HostStartSeconds = 0;
	FString CaptureDir;
	double CaptureFps = 0, NextCapture = 0;
	int32 CaptureIndex = 0;
	double CaptureStart = -1;
	FString CaptureTimes;
	/** Screenshots wait their turn: the engine keeps only one request, and a newer one replaces it. */
	TArray<FString> CaptureQueue;
	int32 ExitDelays = 0;
	FIntPoint Viewport = FIntPoint::ZeroValue;
	TArray<FJsgbScriptStep> Script;
	int32 ScriptCursor = 0;
	FString WaitFor;
	bool bWaitGone = false;
	/** "objects <n>": the wait holds until Unreal draws at least n objects; -1 for an element wait. */
	int32 WaitObjects = -1;
	/** A wait that came true in the game ends once the overlay shows this UI version. */
	int32 WaitUIVersion = -1;
	TSharedPtr<FAnswer> WaitQuery;
	TArray<TPair<FString, TSharedRef<FAnswer>>> ScriptAnswers;
	double WaitStart = 0;
	/** Game seconds at which the JavaScript thread found what the current wait asks for; -1 until then. */
	double WaitSeen = -1;
	/** The fixed game clock stops while the overlay catches up with a wait's DOM change. */
	bool bHoldClock = false;
	double JsMs = 0;
	int32 TimedFrames = 0;
	// Hot reload timing: from the moment a new bundle arrives to the first frame it draws.
	double ReloadStart = -1, ReloadBuildMs = -1, LastReloadMs = -1, LastBuildMs = -1;
	// Upscaling and the optional FPS readout (-JsgbHud).
	FString Upscaler;
	/** The DLSS mode asked for (dlaa, quality, ..., 5, or empty), and the DLSS 5 check's result for the readout. */
	FString DlssMode;
	FString NeuralNote;
	bool bFrameGen = false;
	/** Frames generated per rendered frame: 1 (2x) to 3 (4x). */
	int32 FrameGenFrames = 1;
	/** -JsgbDlssKeys: F6 and F7 switch DLSS while the game runs, and the readout lists the keys. */
	bool bShowKeys = false;
	bool bShowHud = false;
	/** The jitter readout under the frame rate (-JsgbJitter, F8 with -JsgbDlssKeys): the last 600 frame times in ms. */
	bool bShowJitter = false;
	TArray<float> JitterMs;
	int32 JitterHead = 0;
	FString JitterLine;
	int32 HudFrames = 0;
	double HudSeconds = 0, HudFps = 0, HudPresentedFps = -1;
	TSharedPtr<class STextBlock> HudText;
	/** Frame times in ms since GET /bridge/frametimes last read them. */
	TArray<float> FrameTimesMs;
	double LastTickWall = 0;
	/** The last tick's js, mirror, build queue, builds, build stall and UI push times, for the slow-frame log. */
	TArray<double> LastTick;
	/** Unreal's own per-frame times (as stat unit shows them), summed since the last frame log: game thread, render thread,
	 *  RHI thread and GPU, in ms. */
	double EngineMs[4] = {0, 0, 0, 0};
	int32 EngineFrames = 0;
	// CSS hot swap timing: from the request to the overlay painting the new stylesheet.
	int32 CssVersion = 0;
	double CssStart = -1, CssBuildMs = -1, LastCssMs = -1;
	// Live recording (POST /bridge/record): the window with its overlay as JPEG frames, each stamped
	// with wall-clock Unix milliseconds so another recorder on the same machine can line up with it.
	FString RecordDir, RecordTimes;
	double RecordFps = 30, NextRecord = 0;
	int32 RecordIndex = 0;
	FDelegateHandle RecordHandle;
	TSharedPtr<FThreadSafeCounter> RecordEncoding;
	/** Reads recorded frames back from the GPU a few frames later, so recording doesn't make the CPU wait for the GPU. */
	TSharedPtr<class FFrameGrabber> Grabber;
	TSharedPtr<class SWidget> Banner;
	/** The loading screen: the game's name and a moving bar, from launch until the game shows something. */
	TSharedPtr<class SWidget> Loading;
	double LoadingStart = 0;
	void ShowLoading();
	void UpdateLoading();
	TSharedPtr<class STextBlock> BannerText;
	double BannerUntil = 0;
};

UCLASS()
class JSGAMEBRIDGE_API AJsgbGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	AJsgbGameMode();
	virtual void StartPlay() override;
};
