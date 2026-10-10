#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameFramework/GameModeBase.h"
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
	void SendMouse(const FString& Type, float X, float Y, int32 Button, int32 Buttons, float DX, float DY);
	void SendWheel(float DeltaY);
	void SendGamepads(const FString& Json);
	FString Eval(const FString& Source);
	bool HasOverlay() const { return Browser.IsValid(); }

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
	double GameSeconds() const;

	TSharedPtr<PUERTS_NAMESPACE::FJsEnv> JsEnv;
	TSharedPtr<SWebBrowser> Browser;
	TSharedPtr<IHttpRouter> Router;
	FDelegateHandle RouteHandle;
	TSharedPtr<class FJsgbInputProcessor> Input;
	TArray<FString> PublicRoots;
	FString Search, RegistryJson, PageCss;
	bool bDocumentReady = false;
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
	/** A wait that came true in the game ends once the overlay shows this UI version. */
	int32 WaitUIVersion = -1;
	double WaitStart = 0;
	double JsMs = 0;
	int32 TimedFrames = 0;
	// Hot reload timing: from the moment a new bundle arrives to the first frame it draws.
	double ReloadStart = -1, ReloadBuildMs = -1, LastReloadMs = -1, LastBuildMs = -1;
	TSharedPtr<class SWidget> Banner;
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
