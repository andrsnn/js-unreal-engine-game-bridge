#include "JsgbHost.h"
#include "JsgbBridge.h"
#include "JsgbSceneMirror.h"
#include "JsgbAudio.h"
#include "JsEnv.h"
#include "JSLogger.h"
#include "JSModuleLoader.h"
#include "Camera/CameraComponent.h"
#include "Components/SkyLightComponent.h"
#include "EngineUtils.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/SkyLight.h"
#include "Engine/DirectionalLight.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInterface.h"
#include "Framework/Application/SlateApplication.h"
#include "Framework/Application/IInputProcessor.h"
#include "Widgets/SWindow.h"
#include "SWebBrowser.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "WebBrowserModule.h"
#include "HttpServerModule.h"
#include "IHttpRouter.h"
#include "HttpServerResponse.h"
#include "Interfaces/IPluginManager.h"
#include "HAL/FileManager.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"
#include "UnrealClient.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
THIRD_PARTY_INCLUDES_START
#include <openssl/sha.h>
THIRD_PARTY_INCLUDES_END

DEFINE_LOG_CATEGORY_STATIC(LogJsgbHost, Log, All);

namespace
{
	FString Arg(const TCHAR* Key, const FString& Default = FString())
	{
		FString Value;
		return FParse::Value(FCommandLine::Get(), Key, Value, false) ? Value : Default;
	}

	FString Sha256File(const FString& Path)
	{
		TArray<uint8> Bytes;
		if (!FFileHelper::LoadFileToArray(Bytes, *Path)) { return FString(); }
		uint8 Digest[SHA256_DIGEST_LENGTH];
		SHA256(Bytes.GetData(), Bytes.Num(), Digest);
		return BytesToHex(Digest, SHA256_DIGEST_LENGTH).ToLower();
	}

	TSharedPtr<FJsonObject> LoadJson(const FString& Path)
	{
		FString Text; TSharedPtr<FJsonObject> Obj;
		if (FFileHelper::LoadFileToString(Text, *Path)) { FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Obj); }
		return Obj;
	}

	FString JsonString(const TSharedRef<FJsonObject>& O)
	{
		FString Text;
		FJsonSerializer::Serialize(O, TJsonWriterFactory<>::Create(&Text));
		return Text;
	}

	FString Body(const FHttpServerRequest& R) { return FString(FUTF8ToTCHAR(reinterpret_cast<const ANSICHAR*>(R.Body.GetData()), R.Body.Num())); }

	void ConfigurePost(FPostProcessSettings& P)
	{
		// Three.js shades without exposure adaptation. A manual exposure of 1 keeps its light values.
		P.bOverride_AutoExposureMethod = true; P.AutoExposureMethod = AEM_Manual;
		P.bOverride_AutoExposureApplyPhysicalCameraExposure = true; P.AutoExposureApplyPhysicalCameraExposure = false;
		P.bOverride_AutoExposureBias = true; P.AutoExposureBias = 0.f;
		P.bOverride_BloomIntensity = true; P.BloomIntensity = 0.f;
		P.bOverride_VignetteIntensity = true; P.VignetteIntensity = 0.f;
		P.bOverride_MotionBlurAmount = true; P.MotionBlurAmount = 0.f;
		P.bOverride_FilmGrainIntensity = true; P.FilmGrainIntensity = 0.f;
		P.bOverride_DynamicGlobalIlluminationMethod = true; P.DynamicGlobalIlluminationMethod = EDynamicGlobalIlluminationMethod::None;
		P.bOverride_ReflectionMethod = true; P.ReflectionMethod = EReflectionMethod::ScreenSpace;
		P.bOverride_AmbientOcclusionIntensity = true; P.AmbientOcclusionIntensity = 0.35f;
		// The fog/background post material is added by the mirror as an instance (UJsgbSceneMirror::ApplyPost).
	}

	FString DomCode(const FKey& Key)
	{
		const FString N = Key.GetFName().ToString();
		if (N.Len() == 1 && FChar::IsAlpha(N[0])) { return TEXT("Key") + N.ToUpper(); }
		static const TMap<FString, FString> Map = {
			{TEXT("Zero"), TEXT("Digit0")}, {TEXT("One"), TEXT("Digit1")}, {TEXT("Two"), TEXT("Digit2")}, {TEXT("Three"), TEXT("Digit3")}, {TEXT("Four"), TEXT("Digit4")},
			{TEXT("Five"), TEXT("Digit5")}, {TEXT("Six"), TEXT("Digit6")}, {TEXT("Seven"), TEXT("Digit7")}, {TEXT("Eight"), TEXT("Digit8")}, {TEXT("Nine"), TEXT("Digit9")},
			{TEXT("SpaceBar"), TEXT("Space")}, {TEXT("Enter"), TEXT("Enter")}, {TEXT("Escape"), TEXT("Escape")}, {TEXT("Tab"), TEXT("Tab")}, {TEXT("BackSpace"), TEXT("Backspace")},
			{TEXT("LeftShift"), TEXT("ShiftLeft")}, {TEXT("RightShift"), TEXT("ShiftRight")}, {TEXT("LeftControl"), TEXT("ControlLeft")}, {TEXT("RightControl"), TEXT("ControlRight")},
			{TEXT("LeftAlt"), TEXT("AltLeft")}, {TEXT("RightAlt"), TEXT("AltRight")}, {TEXT("Up"), TEXT("ArrowUp")}, {TEXT("Down"), TEXT("ArrowDown")}, {TEXT("Left"), TEXT("ArrowLeft")},
			{TEXT("Right"), TEXT("ArrowRight")}, {TEXT("Delete"), TEXT("Delete")}, {TEXT("Tilde"), TEXT("Backquote")}, {TEXT("Hyphen"), TEXT("Minus")}, {TEXT("Equals"), TEXT("Equal")},
			{TEXT("LeftBracket"), TEXT("BracketLeft")}, {TEXT("RightBracket"), TEXT("BracketRight")}, {TEXT("Semicolon"), TEXT("Semicolon")}, {TEXT("Apostrophe"), TEXT("Quote")},
			{TEXT("Comma"), TEXT("Comma")}, {TEXT("Period"), TEXT("Period")}, {TEXT("Slash"), TEXT("Slash")}, {TEXT("Backslash"), TEXT("Backslash")}, {TEXT("CapsLock"), TEXT("CapsLock")},
			{TEXT("Home"), TEXT("Home")}, {TEXT("End"), TEXT("End")}, {TEXT("PageUp"), TEXT("PageUp")}, {TEXT("PageDown"), TEXT("PageDown")}, {TEXT("Insert"), TEXT("Insert")}};
		if (const FString* Found = Map.Find(N)) { return *Found; }
		if (N.StartsWith(TEXT("F")) && N.Len() <= 3 && N.Len() > 1 && FChar::IsDigit(N[1])) { return N; }
		return FString();
	}

	// Gamepad API "standard" layout.
	const FKey PadButtons[17] = {EKeys::Gamepad_FaceButton_Bottom, EKeys::Gamepad_FaceButton_Right, EKeys::Gamepad_FaceButton_Left, EKeys::Gamepad_FaceButton_Top,
		EKeys::Gamepad_LeftShoulder, EKeys::Gamepad_RightShoulder, EKeys::Gamepad_LeftTriggerAxis, EKeys::Gamepad_RightTriggerAxis, EKeys::Gamepad_Special_Left,
		EKeys::Gamepad_Special_Right, EKeys::Gamepad_LeftThumbstick, EKeys::Gamepad_RightThumbstick, EKeys::Gamepad_DPad_Up, EKeys::Gamepad_DPad_Down,
		EKeys::Gamepad_DPad_Left, EKeys::Gamepad_DPad_Right, EKeys::Invalid};
}

/** Keyboard and mouse go to the game as DOM events when there is no CEF overlay (the overlay
 *  forwards its own events otherwise). Gamepads always come through here. */
class FJsgbInputProcessor : public IInputProcessor
{
public:
	explicit FJsgbInputProcessor(AJsgbHost* InHost) : Host(InHost) { FMemory::Memzero(Buttons); FMemory::Memzero(Axes); }
	virtual void Tick(const float DeltaTime, FSlateApplication& SlateApp, TSharedRef<ICursor> Cursor) override
	{
		AJsgbHost* H = Host.Get();
		if (!H || !bPadSeen) { return; }
		FString Json = TEXT("[{\"id\":\"Unreal gamepad (STANDARD GAMEPAD)\",\"buttons\":[");
		for (int32 I = 0; I < 17; ++I) { Json += FString::Printf(TEXT("%s%.3f"), I ? TEXT(",") : TEXT(""), Buttons[I]); }
		Json += FString::Printf(TEXT("],\"axes\":[%.3f,%.3f,%.3f,%.3f]}]"), Axes[0], -Axes[1], Axes[2], -Axes[3]);
		if (Json != Last) { Last = Json; H->SendGamepads(Json); }
	}
	virtual bool HandleKeyDownEvent(FSlateApplication& SlateApp, const FKeyEvent& E) override { return Key(E, true); }
	virtual bool HandleKeyUpEvent(FSlateApplication& SlateApp, const FKeyEvent& E) override { return Key(E, false); }
	virtual bool HandleAnalogInputEvent(FSlateApplication& SlateApp, const FAnalogInputEvent& E) override
	{
		const FKey K = E.GetKey();
		const float V = E.GetAnalogValue();
		if (K == EKeys::Gamepad_LeftX) { Axes[0] = V; } else if (K == EKeys::Gamepad_LeftY) { Axes[1] = V; }
		else if (K == EKeys::Gamepad_RightX) { Axes[2] = V; } else if (K == EKeys::Gamepad_RightY) { Axes[3] = V; }
		else if (K == EKeys::Gamepad_LeftTriggerAxis) { Buttons[6] = V; } else if (K == EKeys::Gamepad_RightTriggerAxis) { Buttons[7] = V; }
		else { return false; }
		bPadSeen = true;
		return false;
	}
	virtual bool HandleMouseMoveEvent(FSlateApplication& SlateApp, const FPointerEvent& E) override
	{
		AJsgbHost* H = Host.Get();
		if (H && !H->HasOverlay()) { const FVector2D P = Local(E); H->SendMouse(TEXT("mousemove"), P.X, P.Y, 0, MouseButtons, E.GetCursorDelta().X, E.GetCursorDelta().Y); }
		return false;
	}
	virtual bool HandleMouseButtonDownEvent(FSlateApplication& SlateApp, const FPointerEvent& E) override { return Button(E, true); }
	virtual bool HandleMouseButtonUpEvent(FSlateApplication& SlateApp, const FPointerEvent& E) override { return Button(E, false); }
	virtual bool HandleMouseButtonDoubleClickEvent(FSlateApplication& SlateApp, const FPointerEvent& E) override { return Button(E, true); }
	virtual bool HandleMouseWheelOrGestureEvent(FSlateApplication& SlateApp, const FPointerEvent& E, const FPointerEvent* Gesture) override
	{
		AJsgbHost* H = Host.Get();
		if (H && !H->HasOverlay()) { H->SendWheel(-E.GetWheelDelta() * 100.f); }
		return false;
	}
	virtual const TCHAR* GetDebugName() const override { return TEXT("JsGameBridgeInput"); }
private:
	FVector2D Local(const FPointerEvent& E) const
	{
		FVector2D P = E.GetScreenSpacePosition();
		if (GEngine && GEngine->GameViewport && GEngine->GameViewport->GetWindow().IsValid()) { P -= GEngine->GameViewport->GetWindow()->GetPositionInScreen(); }
		return P;
	}
	bool Key(const FKeyEvent& E, bool bDown)
	{
		AJsgbHost* H = Host.Get();
		if (!H) { return false; }
		for (int32 I = 0; I < 16; ++I) { if (E.GetKey() == PadButtons[I]) { Buttons[I] = bDown ? 1.f : 0.f; bPadSeen = true; return false; } }
		if (H->HasOverlay()) { return false; }
		const FString Code = DomCode(E.GetKey());
		if (Code.IsEmpty()) { return false; }
		H->SendKey(bDown ? TEXT("keydown") : TEXT("keyup"), Code, bDown && E.IsRepeat());
		return Code != TEXT("Backquote");
	}
	bool Button(const FPointerEvent& E, bool bDown)
	{
		AJsgbHost* H = Host.Get();
		if (!H || H->HasOverlay()) { return false; }
		const FKey K = E.GetEffectingButton();
		const int32 B = K == EKeys::LeftMouseButton ? 0 : K == EKeys::MiddleMouseButton ? 1 : K == EKeys::RightMouseButton ? 2 : 3;
		const int32 Bit = B == 0 ? 1 : B == 1 ? 4 : B == 2 ? 2 : 8;
		if (bDown) { MouseButtons |= Bit; } else { MouseButtons &= ~Bit; }
		const FVector2D P = Local(E);
		H->SendMouse(bDown ? TEXT("mousedown") : TEXT("mouseup"), P.X, P.Y, B, MouseButtons, 0, 0);
		return false;
	}
	TWeakObjectPtr<AJsgbHost> Host;
	int32 MouseButtons = 0;
	float Buttons[17];
	float Axes[4];
	bool bPadSeen = false;
	FString Last;
};

/** Finds modules by absolute path as well as Puerts' usual JavaScript folders. */
class FJsgbModuleLoader final : public PUERTS_NAMESPACE::DefaultJSModuleLoader
{
public:
	FJsgbModuleLoader() : DefaultJSModuleLoader(TEXT("JavaScript")) {}
	virtual bool Search(const FString& Dir, const FString& Module, FString& Path, FString& Absolute) override
	{
		if (!FPaths::IsRelative(Module) && CheckExists(Module, Path, Absolute)) { return true; }
		return DefaultJSModuleLoader::Search(Dir, Module, Path, Absolute);
	}
};

void UJsgbUIPort::SendInput(const FString& Json)
{
	if (Json.StartsWith(TEXT("{\"type\":\"host-layout\"")))
	{
		++LayoutMessages;
		const int32 At = Json.Find(TEXT("\"version\":"));
		if (At >= 0) { AppliedUIVersion = FCString::Atoi(*Json.Mid(At + 10, 12)); }
		const int32 W = Json.Find(TEXT("\"width\":")), H = Json.Find(TEXT("\"height\":")), R = Json.Find(TEXT("\"pixelRatio\":"));
		const FString Size = FString::Printf(TEXT("%s x %s, pixel ratio %s"), W >= 0 ? *Json.Mid(W + 8, 6) : TEXT("?"), H >= 0 ? *Json.Mid(H + 9, 6) : TEXT("?"), R >= 0 ? *Json.Mid(R + 13, 6) : TEXT("?"));
		if (Size != LastLayoutSize) { LastLayoutSize = Size; UE_LOG(LogTemp, Display, TEXT("UI overlay page size %s"), *Size); }
	}
	if (Bridge && Bridge->OnUIInput.IsBound()) { Bridge->OnUIInput.Execute(Json); }
}

AJsgbHost::AJsgbHost()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Mirror = CreateDefaultSubobject<UJsgbSceneMirror>(TEXT("Mirror"));
	Audio = CreateDefaultSubobject<UJsgbAudio>(TEXT("Audio"));
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(RootComponent);
	Camera->bConstrainAspectRatio = false;
}

bool AJsgbHost::LoadPublication(const FString& Dir, const FString& OverrideBundle)
{
	const TSharedPtr<FJsonObject> Pub = LoadJson(Dir / TEXT("publication.json"));
	if (!Pub) { UE_LOG(LogJsgbHost, Error, TEXT("No publication.json in %s; build the game with Tools/jsgb.mjs build <game>"), *Dir); return false; }
	GameDir = Dir;
	BundlePath = OverrideBundle.IsEmpty() ? Pub->GetStringField(TEXT("bundle")) : OverrideBundle;
	SourceCommit = Pub->GetStringField(TEXT("sourceCommit"));
	Pub->TryGetStringField(TEXT("title"), Title);
	BundleSHA256 = Sha256File(BundlePath);
	Search = Arg(TEXT("JsgbSearch="), Pub->HasField(TEXT("search")) ? Pub->GetStringField(TEXT("search")) : FString());
	PublicRoots.Reset();
	const TArray<TSharedPtr<FJsonValue>>* Roots = nullptr;
	if (Pub->TryGetArrayField(TEXT("publicRoots"), Roots)) { for (const TSharedPtr<FJsonValue>& R : *Roots) { PublicRoots.Add(R->AsString()); } }
	PageCss.Reset();
	if (const TSharedPtr<FJsonObject> Page = LoadJson(Dir / TEXT("page.json"))) { FFileHelper::LoadFileToString(PageCss, *(Dir / Page->GetStringField(TEXT("css")))); }
	RegistryJson.Reset();
	FFileHelper::LoadFileToString(RegistryJson, *(Dir / TEXT("registry.json")));
	Mirror->SetAssetRegistry(RegistryJson.IsEmpty() ? TEXT("{\"assets\":{}}") : RegistryJson);
	TMap<FString, FString> Files;
	if (const TSharedPtr<FJsonObject> Reg = LoadJson(Dir / TEXT("registry.json")))
	{
		const TSharedPtr<FJsonObject>* Map = nullptr;
		if (Reg->TryGetObjectField(TEXT("files"), Map)) { for (const auto& F : (*Map)->Values) { Files.Add(FString(*F.Key), F.Value->AsString()); } }
	}
	Audio->SetFileAssets(Files);
	UE_LOG(LogJsgbHost, Display, TEXT("Game %s: bundle %s (%s), %d public roots, %d audio files mapped"), *Title, *BundlePath, *SourceCommit.Left(10), PublicRoots.Num(), Files.Num());
	return true;
}

void AJsgbHost::BeginPlay()
{
	Super::BeginPlay();
	UWorld* World = GetWorld();
	// Custom depth with stencil: the scene post reads it to leave fog-free surfaces unfogged.
	if (IConsoleVariable* CustomDepth = IConsoleManager::Get().FindConsoleVariable(TEXT("r.CustomDepth"))) { CustomDepth->Set(3, ECVF_SetByCode); }
	// FXAA, like a browser's MSAA, keeps no history between frames. Temporal AA smeared camera-facing
	// billboards (stars, sprites) into streaks, because their offset follows the camera.
	if (IConsoleVariable* Aa = IConsoleManager::Get().FindConsoleVariable(TEXT("r.AntiAliasingMethod"))) { Aa->Set(1, ECVF_SetByCode); }
	// The web scene supplies all lighting, fog and sky. Remove whatever the boot map brought.
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		AActor* A = *It;
		if (A == this) { continue; }
		const bool bEnvironment = A->IsA<AExponentialHeightFog>() || A->IsA<APostProcessVolume>() || A->IsA<ASkyLight>() || A->IsA<ADirectionalLight>()
			|| A->FindComponentByClass<USkyAtmosphereComponent>() || A->FindComponentByClass<UVolumetricCloudComponent>() || A->FindComponentByClass<UExponentialHeightFogComponent>();
		if (bEnvironment) { A->Destroy(); }
	}
	ConfigurePost(Camera->PostProcessSettings);
	Camera->PostProcessBlendWeight = 1.f;
	// Engine warnings printed over the game view are not part of the game.
	if (GEngine && !FParse::Param(FCommandLine::Get(), TEXT("JsgbScreenMessages"))) { GEngine->bEnableOnScreenDebugMessages = false; GEngine->Exec(World, TEXT("DisableAllScreenMessages")); }
	Mirror->Camera = Camera;
	Audio->MasterGain = FCString::Atof(*Arg(TEXT("JsgbVolume="), TEXT("1")));
	if (APlayerController* Pc = UGameplayStatics::GetPlayerController(World, 0))
	{
		Pc->SetViewTarget(this);
		Pc->bShowMouseCursor = true;
	}
	if (FSlateApplication::IsInitialized())
	{
		Input = MakeShared<FJsgbInputProcessor>(this);
		FSlateApplication::Get().RegisterInputPreProcessor(Input);
	}
	FParse::Value(FCommandLine::Get(), TEXT("JsgbPort="), Port);
	FParse::Value(FCommandLine::Get(), TEXT("JsgbFrames="), ExitFrame);
	FParse::Value(FCommandLine::Get(), TEXT("JsgbMaxSeconds="), MaxSeconds);
	HostStartSeconds = FPlatformTime::Seconds();
	CaptureDir = Arg(TEXT("JsgbCapture="));
	FParse::Value(FCommandLine::Get(), TEXT("JsgbCaptureFps="), CaptureFps);
	if (!CaptureDir.IsEmpty()) { IFileManager::Get().MakeDirectory(*CaptureDir, true); }
	const FString ScriptPath = Arg(TEXT("JsgbScript="));
	if (!ScriptPath.IsEmpty()) { LoadScript(ScriptPath); }
	if (!LoadPublication(Arg(TEXT("JsgbGame=")), FString())) { return; }
	StartServer();
	StartJs();
	CreateOverlay();
}

void AJsgbHost::StartJs()
{
	Bridge = NewObject<UJsgbBridge>(this);
	Bridge->Mirror = Mirror;
	Bridge->Audio = Audio;
	Mirror->Bridge = Bridge;
	Audio->Bridge = Bridge;
	if (UIPort) { UIPort->Bridge = Bridge; UIPort->AppliedUIVersion = -1; }
	Bridge->StartSeconds = FPlatformTime::Seconds();
	double FixedFps = 0;
	if (FParse::Value(FCommandLine::Get(), TEXT("JsgbFixedFps="), FixedFps) && FixedFps > 0) { Bridge->FixedStepMs = 1000.0 / FixedFps; }
	Bridge->Search = Search;
	Bridge->Trace = FParse::Param(FCommandLine::Get(), TEXT("JsgbTraceMirror"));
	Mirror->bTrace = Bridge->Trace;
	FParse::Value(FCommandLine::Get(), TEXT("JsgbSeed="), Bridge->Seed);
	Bridge->Registry = RegistryJson;
	Bridge->BundlePath = BundlePath;
	Bridge->PublicRoots = PublicRoots;
	const FString GameId = FPaths::GetBaseFilename(BundlePath);
	Bridge->StoreDir = FPaths::ProjectSavedDir() / TEXT("JsGameBridge") / GameId / TEXT("Store");
	if (FParse::Param(FCommandLine::Get(), TEXT("JsgbFresh")) && ReadyFrame < 0 && Frame == 0) { IFileManager::Get().DeleteDirectory(*Bridge->StoreDir, false, true); }
	IFileManager::Get().MakeDirectory(*Bridge->StoreDir, true);
	Bridge->LogPath = FPaths::ProjectSavedDir() / TEXT("JsGameBridge") / GameId / TEXT("js.log");
	IFileManager::Get().Delete(*Bridge->LogPath);

	const FString PluginDir = IPluginManager::Get().FindPlugin(TEXT("JsGameBridge"))->GetBaseDir();
	const FString Bootstrap = FPaths::ConvertRelativePathToFull(PluginDir / TEXT("JavaScript/jsgb-main.js"));
	const double T0 = FPlatformTime::Seconds();
	JsEnv = MakeShared<PUERTS_NAMESPACE::FJsEnv>(std::make_shared<FJsgbModuleLoader>(), std::make_shared<PUERTS_NAMESPACE::FDefaultLogger>(), -1, nullptr, TEXT("--max-old-space-size=8192"));
	TArray<TPair<FString, UObject*>> Args;
	Args.Add(TPair<FString, UObject*>(TEXT("Bridge"), Bridge));
	JsEnv->Start(Bootstrap, Args);
	Bridge->Log(TEXT("log"), FString::Printf(TEXT("js env started in %.0f ms (%s), frame bound=%d"), (FPlatformTime::Seconds() - T0) * 1000.0, *BundlePath, Bridge->OnFrame.IsBound() ? 1 : 0));
	Viewport = FIntPoint::ZeroValue;
	ReadyFrame = -1;
	PushedUIVersion = -1;
	if (Browser.IsValid() && bDocumentReady) { Browser->ExecuteJavascript(TEXT("window.JsGameUI&&window.JsGameUI.reset()")); }
}

void AJsgbHost::StopJs()
{
	if (Bridge)
	{
		Bridge->OnFrame.Clear(); Bridge->OnUIInput.Clear(); Bridge->OnKey.Clear(); Bridge->OnMouse.Clear();
		Bridge->OnWheel.Clear(); Bridge->OnViewport.Clear(); Bridge->OnGamepads.Clear(); Bridge->OnEval.Clear();
		Bridge->Mirror = nullptr; Bridge->Audio = nullptr;
	}
	JsEnv.Reset();
	Mirror->ResetAll();
	Audio->StopAll();
}

void AJsgbHost::CreateOverlay()
{
	if (Browser.IsValid() || FParse::Param(FCommandLine::Get(), TEXT("JsgbNoUI")) || FParse::Param(FCommandLine::Get(), TEXT("nullrhi"))) { return; }
	if (!GEngine || !GEngine->GameViewport) { return; }
	if (!IWebBrowserModule::Get().IsWebModuleAvailable()) { UE_LOG(LogJsgbHost, Error, TEXT("CEF is not available; the game UI will not show")); return; }
	FString Client;
	const FString PluginDir = IPluginManager::Get().FindPlugin(TEXT("JsGameBridge"))->GetBaseDir();
	FFileHelper::LoadFileToString(Client, *(PluginDir / TEXT("JavaScript/jsgb-ui-client.js")));
	UIPort = NewObject<UJsgbUIPort>(this);
	UIPort->Bridge = Bridge;
	SAssignNew(Browser, SWebBrowser).InitialURL(TEXT("about:blank"))
		.ShowControls(false).ShowAddressBar(false).ShowInitialThrobber(false)
		.SupportsTransparency(true).BackgroundColor(FColor(0, 0, 0, 0)).BrowserFrameRate(60)
		.PopupMenuMethod(EPopupMethod::UseCurrentWindow)
		.OnLoadStarted_Lambda([this]() { bDocumentReady = false; })
		.OnLoadCompleted_Lambda([this]() { bDocumentReady = true; PushedUIVersion = -1; UE_LOG(LogJsgbHost, Display, TEXT("UI overlay document loaded")); })
		.OnLoadError_Lambda([]() { UE_LOG(LogJsgbHost, Error, TEXT("UI overlay document failed to load")); })
		.OnConsoleMessage_Lambda([](const FString& Message, const FString& Source, int32 Line, EWebBrowserConsoleLogSeverity Severity)
		{
			UE_LOG(LogJsgbHost, Display, TEXT("UI console %d %s:%d %s"), static_cast<int32>(Severity), *Source, Line, *Message.Left(2048));
		})
		.OnBeforePopup_Lambda([](FString, FString) { return true; });
	Browser->BindUObject(TEXT("jsgb"), UIPort, true);
	GEngine->GameViewport->AddViewportWidgetContent(Browser.ToSharedRef(), 100);
	const FString Origin = FString::Printf(TEXT("http://127.0.0.1:%d/"), Port);
	// The page's own stylesheets, with every full-screen background made transparent so the
	// Unreal view shows through where the web canvas was.
	const FString Html = TEXT("<!doctype html><html><head><meta charset='utf-8'><base href='") + Origin + TEXT("'><title>") + Title + TEXT("</title><style>") + PageCss +
		TEXT("\nhtml,body{background:transparent!important;overflow:hidden!important}::-webkit-scrollbar{display:none}canvas{background:transparent!important;opacity:0!important}</style><script>") + Client + TEXT("</script></head><body></body></html>");
	Browser->LoadString(Html, Origin + TEXT("index.html"));
	if (APlayerController* Pc = UGameplayStatics::GetPlayerController(GetWorld(), 0))
	{
		FInputModeGameAndUI Mode;
		Mode.SetWidgetToFocus(Browser);
		Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
		Mode.SetHideCursorDuringCapture(false);
		Pc->SetInputMode(Mode);
	}
}

void AJsgbHost::ShowReloadBanner(const FString& Text)
{
	if (!GEngine || !GEngine->GameViewport) { return; }
	if (!Banner.IsValid())
	{
		Banner = SNew(SBox).HAlign(HAlign_Left).VAlign(VAlign_Bottom).Padding(FMargin(16, 0, 0, 72)).Visibility(EVisibility::HitTestInvisible)
			[
				SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(0.f, 0.f, 0.f, 0.72f)).Padding(FMargin(14, 8))
				[
					SAssignNew(BannerText, STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Bold", 18)).ColorAndOpacity(FLinearColor(1.f, 0.82f, 0.35f))
				]
			];
		GEngine->GameViewport->AddViewportWidgetContent(Banner.ToSharedRef(), 200);
	}
	BannerText->SetText(FText::FromString(Text));
	Banner->SetVisibility(EVisibility::HitTestInvisible);
	BannerUntil = FPlatformTime::Seconds() + 8.0;
}

void AJsgbHost::PushUI()
{
	if (!Browser.IsValid() || !bDocumentReady || !Bridge || Bridge->UIVersion == PushedUIVersion) { return; }
	PushedUIVersion = Bridge->UIVersion;
	auto Packet = MakeShared<FJsonObject>();
	Packet->SetStringField(TEXT("html"), Bridge->UIHtml);
	Browser->ExecuteJavascript(TEXT("window.JsGameUI&&window.JsGameUI.apply((") + JsonString(Packet) + FString::Printf(TEXT(").html, %d)"), PushedUIVersion));
}

void AJsgbHost::StartServer()
{
	if (Router) { return; }
	Router = FHttpServerModule::Get().GetHttpRouter(Port, true);
	if (!Router) { UE_LOG(LogJsgbHost, Error, TEXT("Cannot listen on port %d"), Port); return; }
	TWeakObjectPtr<AJsgbHost> Weak(this);
	RouteHandle = Router->RegisterRequestPreprocessor(FHttpRequestHandler::CreateLambda([Weak](const FHttpServerRequest& R, const FHttpResultCallback& Done)
	{
		AJsgbHost* H = Weak.Get();
		if (!H) { return false; }
		const FString Route = R.RelativePath.GetPath().IsEmpty() ? R.FullPath.GetPath() : R.FullPath.GetPath();
		const bool bPost = R.Verb == EHttpServerRequestVerbs::VERB_POST;
		const bool bRemote = FParse::Param(FCommandLine::Get(), TEXT("JsgbAllowRemote"));
		auto Json = [&Done](const TSharedRef<FJsonObject>& O, EHttpServerResponseCodes Code = EHttpServerResponseCodes::Ok)
		{
			TUniquePtr<FHttpServerResponse> Resp = FHttpServerResponse::Create(JsonString(O), TEXT("application/json"));
			Resp->Code = Code;
			Done(MoveTemp(Resp));
		};
		if (Route == TEXT("/bridge/status"))
		{
			auto O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("game"), H->Title);
			O->SetStringField(TEXT("sourceCommit"), H->SourceCommit);
			O->SetStringField(TEXT("bundleSHA256"), H->BundleSHA256);
			O->SetStringField(TEXT("bundle"), H->BundlePath);
			O->SetBoolField(TEXT("ready"), H->Bridge && H->Bridge->bReady && !H->bRestart);
			O->SetNumberField(TEXT("hostFrames"), H->Frame);
			O->SetNumberField(TEXT("lastReloadMs"), H->ReloadStart >= 0 ? -1 : H->LastReloadMs);
			O->SetNumberField(TEXT("lastBuildMs"), H->LastBuildMs);
			O->SetNumberField(TEXT("sceneFrames"), H->Bridge ? H->Bridge->SceneFrames : 0);
			O->SetNumberField(TEXT("drawn"), H->Mirror->DrawnEntities);
			O->SetNumberField(TEXT("pendingBuilds"), H->Mirror->PendingBuilds());
			O->SetNumberField(TEXT("jsErrors"), H->Bridge ? H->Bridge->ErrorCount : 0);
			O->SetNumberField(TEXT("uiVersion"), H->Bridge ? H->Bridge->UIVersion : 0);
			O->SetNumberField(TEXT("uiLayoutMessages"), H->UIPort ? H->UIPort->LayoutMessages : 0);
			O->SetNumberField(TEXT("voicesStarted"), H->Audio->StartedVoices);
			O->SetNumberField(TEXT("voicesActive"), H->Audio->ActiveVoices());
			O->SetNumberField(TEXT("voicesUnplayable"), H->Audio->UnplayableVoices);
			O->SetNumberField(TEXT("jsMs"), H->TimedFrames ? H->JsMs / H->TimedFrames : 0);
			Json(O);
			return true;
		}
		if (Route == TEXT("/bridge/describe"))
		{
			const FString Request = Body(R);
			if (Request.StartsWith(TEXT("hide:"))) { H->Mirror->DebugHiddenKinds = FCString::Atoi(*Request.Mid(5)); }
			TUniquePtr<FHttpServerResponse> Resp = FHttpServerResponse::Create(H->Mirror->Describe(Request.StartsWith(TEXT("hide:")) ? 0 : FCString::Atoi(*Request)), TEXT("application/json"));
			Done(MoveTemp(Resp));
			return true;
		}
		if (Route == TEXT("/bridge/reload") && bPost)
		{
			TSharedPtr<FJsonObject> In;
			FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body(R)), In);
			FString Path, Hash;
			if (!In || !In->TryGetStringField(TEXT("bundlePath"), Path) || !In->TryGetStringField(TEXT("bundleSHA256"), Hash)) { Done(FHttpServerResponse::Error(EHttpServerResponseCodes::BadRequest)); return true; }
			if (FPaths::GetPath(FPaths::ConvertRelativePathToFull(Path)) != FPaths::GetPath(FPaths::ConvertRelativePathToFull(H->BundlePath)))
			{
				Done(FHttpServerResponse::Error(EHttpServerResponseCodes::Forbidden, TEXT("bundle must sit in the game's build folder")));
				return true;
			}
			if (Sha256File(Path) != Hash) { Done(FHttpServerResponse::Error(EHttpServerResponseCodes::BadRequest, TEXT("bundle hash mismatch"))); return true; }
			// Reboot V8 on the next tick, outside this request and any JS callback.
			H->PendingBundle = Path;
			H->bRestart = true;
			H->ReloadStart = FPlatformTime::Seconds();
			H->ReloadBuildMs = In->HasField(TEXT("buildMs")) ? In->GetNumberField(TEXT("buildMs")) : -1;
			auto O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("bundleSHA256"), Hash);
			O->SetBoolField(TEXT("ready"), false);
			Json(O, EHttpServerResponseCodes::Accepted);
			return true;
		}
		if ((Route == TEXT("/bridge/eval") || Route == TEXT("/bridge/input") || Route == TEXT("/bridge/capture") || Route == TEXT("/bridge/close")) && bPost)
		{
			if (!bRemote) { Done(FHttpServerResponse::Error(EHttpServerResponseCodes::Forbidden, TEXT("start Unreal with -JsgbAllowRemote"))); return true; }
			auto O = MakeShared<FJsonObject>();
			if (Route == TEXT("/bridge/eval")) { O->SetStringField(TEXT("result"), H->Eval(Body(R))); }
			else if (Route == TEXT("/bridge/input")) { if (H->UIPort) { H->UIPort->SendInput(Body(R)); } else if (H->Bridge && H->Bridge->OnUIInput.IsBound()) { H->Bridge->OnUIInput.Execute(Body(R)); } O->SetBoolField(TEXT("accepted"), true); }
			else if (Route == TEXT("/bridge/capture")) { const FString Path = Body(R).TrimStartAndEnd(); H->Capture(Path); O->SetStringField(TEXT("path"), Path); }
			else { O->SetBoolField(TEXT("closing"), true); FPlatformMisc::RequestExit(false); }
			Json(O);
			return true;
		}
		if (R.Verb == EHttpServerRequestVerbs::VERB_GET && !Route.StartsWith(TEXT("/bridge/")) && H->Bridge)
		{
			// The overlay's page loads images and fonts from the web build's site root.
			FArrayBufferValue File = H->Bridge->ReadFile(Route);
			if (File.Data.Num() == 0) { Done(FHttpServerResponse::Error(EHttpServerResponseCodes::NotFound)); return true; }
			const FString Ext = FPaths::GetExtension(Route).ToLower();
			static const TMap<FString, FString> Mime = {{TEXT("png"), TEXT("image/png")}, {TEXT("jpg"), TEXT("image/jpeg")}, {TEXT("jpeg"), TEXT("image/jpeg")}, {TEXT("webp"), TEXT("image/webp")},
				{TEXT("gif"), TEXT("image/gif")}, {TEXT("svg"), TEXT("image/svg+xml")}, {TEXT("woff2"), TEXT("font/woff2")}, {TEXT("woff"), TEXT("font/woff")}, {TEXT("ttf"), TEXT("font/ttf")},
				{TEXT("otf"), TEXT("font/otf")}, {TEXT("css"), TEXT("text/css")}, {TEXT("json"), TEXT("application/json")}, {TEXT("ogg"), TEXT("audio/ogg")}, {TEXT("mp3"), TEXT("audio/mpeg")}};
			const FString* Type = Mime.Find(Ext);
			Done(FHttpServerResponse::Create(MoveTemp(File.Data), Type ? *Type : TEXT("application/octet-stream")));
			return true;
		}
		return false;
	}));
	FHttpServerModule::Get().StartAllListeners();
	UE_LOG(LogJsgbHost, Display, TEXT("JsGameBridge host listening on http://127.0.0.1:%d/bridge/status"), Port);
}

void AJsgbHost::EndPlay(const EEndPlayReason::Type Reason)
{
	if (Input.IsValid() && FSlateApplication::IsInitialized()) { FSlateApplication::Get().UnregisterInputPreProcessor(Input); }
	Input.Reset();
	if (Browser.IsValid())
	{
		if (GEngine && GEngine->GameViewport) { GEngine->GameViewport->RemoveViewportWidgetContent(Browser.ToSharedRef()); }
		Browser->UnbindUObject(TEXT("jsgb"), UIPort, true);
		Browser.Reset();
	}
	if (Banner.IsValid() && GEngine && GEngine->GameViewport) { GEngine->GameViewport->RemoveViewportWidgetContent(Banner.ToSharedRef()); }
	Banner.Reset(); BannerText.Reset();
	if (Router) { Router->UnregisterRequestPreprocessor(RouteHandle); Router.Reset(); }
	StopJs();
	Super::EndPlay(Reason);
}

void AJsgbHost::SendKey(const FString& Type, const FString& Code, bool bRepeat) { if (Bridge && Bridge->OnKey.IsBound()) { Bridge->OnKey.Execute(Type, Code, bRepeat); } }
void AJsgbHost::SendMouse(const FString& Type, float X, float Y, int32 Button, int32 Buttons, float DX, float DY) { if (Bridge && Bridge->OnMouse.IsBound()) { Bridge->OnMouse.Execute(Type, X, Y, Button, Buttons, DX, DY); } }
void AJsgbHost::SendWheel(float DeltaY) { if (Bridge && Bridge->OnWheel.IsBound()) { Bridge->OnWheel.Execute(DeltaY); } }
void AJsgbHost::SendGamepads(const FString& Json) { if (Bridge && Bridge->OnGamepads.IsBound()) { Bridge->OnGamepads.Execute(Json); } }
FString AJsgbHost::Eval(const FString& Source) { return Bridge && Bridge->OnEval.IsBound() ? Bridge->OnEval.Execute(Source) : FString(TEXT("ERR no js")); }
double AJsgbHost::GameSeconds() const { return Bridge ? Bridge->NowMs() / 1000.0 : 0.0; }

void AJsgbHost::Capture(const FString& Path)
{
	// The viewport screenshot includes the CEF overlay, so it shows what a player sees.
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path), true);
	CaptureQueue.Add(Path);
	if (!FScreenshotRequest::IsScreenshotRequested()) { FScreenshotRequest::RequestScreenshot(CaptureQueue[0], true, false); CaptureQueue.RemoveAt(0); }
}

void AJsgbHost::LoadScript(const FString& Path)
{
	TArray<FString> Lines;
	FFileHelper::LoadFileToStringArray(Lines, *Path);
	for (const FString& Raw : Lines)
	{
		const FString Line = Raw.TrimStartAndEnd();
		if (Line.IsEmpty() || Line.StartsWith(TEXT("#"))) { continue; }
		FJsgbScriptStep Step;
		FString When, Rest;
		if (!Line.Split(TEXT(" "), &When, &Rest)) { continue; }
		// "@N" runs at host frame N; a plain number is seconds after the game entry finished.
		Step.bAbsolute = When.StartsWith(TEXT("@"));
		if (Step.bAbsolute) { Step.Frame = FCString::Atoi(*When.RightChop(1)); } else { Step.Time = FCString::Atod(*When); }
		Rest.TrimStartInline();
		if (!Rest.Split(TEXT(" "), &Step.Verb, &Step.Args)) { Step.Verb = Rest; }
		Script.Add(Step);
	}
	Script.StableSort([](const FJsgbScriptStep& A, const FJsgbScriptStep& B) { return A.Time < B.Time; });
	UE_LOG(LogJsgbHost, Display, TEXT("Loaded %d script steps from %s"), Script.Num(), *Path);
}

// Script arguments may be quoted ('NEW GAME') or bare (.colony-pointer); bare ones become a JS string.
static FString ScriptArg(const FString& Args)
{
	const FString A = Args.TrimStartAndEnd();
	if (A.IsEmpty() || A[0] == TCHAR('\'') || A[0] == TCHAR('"') || A[0] == TCHAR('`')) { return A; }
	return TEXT("\"") + A.ReplaceCharWithEscapedChar() + TEXT("\"");
}

void AJsgbHost::RunScript()
{
	if (Script.Num() == 0 || ReadyFrame < 0) { return; }
	if (!WaitFor.IsEmpty())
	{
		// "wait <text or selector>" holds the script until that element exists, "gone" until it no
		// longer does (a loading screen closing). Later steps keep their spacing.
		const double Now = GameSeconds();
		const bool bFound = WaitUIVersion >= 0 || (Eval(FString::Printf(TEXT("__jsgb.find(%s)"), *ScriptArg(WaitFor))) == TEXT("true")) != bWaitGone;
		// The game's DOM changed; the wait ends when the overlay shows that change on screen.
		if (bFound && WaitUIVersion < 0 && UIPort && Browser.IsValid()) { Eval(TEXT("__jsgb.publish&&__jsgb.publish()")); WaitUIVersion = Bridge->UIVersion; }
		const bool bShown = !bFound || WaitUIVersion < 0 || !UIPort || UIPort->AppliedUIVersion >= WaitUIVersion;
		if ((!bFound || !bShown) && Now - WaitStart < 120.0) { return; }
		WaitUIVersion = -1;
		Bridge->Log(bFound ? TEXT("log") : TEXT("error"), FString::Printf(TEXT("script %s %s: %s after %.1fs"), bWaitGone ? TEXT("gone") : TEXT("wait"), *WaitFor, bFound ? TEXT("done") : TEXT("timed out"), Now - WaitStart));
		ReadySeconds += Now - WaitStart;
		WaitFor.Reset();
		if (!CaptureDir.IsEmpty()) { CaptureTimes += FString::Printf(TEXT("wait-end %.3f\n"), Now - CaptureStart); }
	}
	const double Rel = GameSeconds() - ReadySeconds;
	while (ScriptCursor < Script.Num() && (Script[ScriptCursor].bAbsolute ? Script[ScriptCursor].Frame <= Frame : Script[ScriptCursor].Time <= Rel))
	{
		const FJsgbScriptStep& S = Script[ScriptCursor++];
		FString Result;
		if (S.Verb == TEXT("wait") || S.Verb == TEXT("gone")) { WaitFor = S.Args; bWaitGone = S.Verb == TEXT("gone"); WaitStart = GameSeconds(); Bridge->Log(TEXT("log"), FString::Printf(TEXT("script %s %s: waiting"), *S.Verb, *S.Args)); return; }
		if (S.Verb == TEXT("eval")) { Result = Eval(S.Args); }
		else if (S.Verb == TEXT("click")) { Result = Eval(FString::Printf(TEXT("__jsgb.click(%s)"), *ScriptArg(S.Args))); }
		else if (S.Verb == TEXT("seed")) { Result = Eval(FString::Printf(TEXT("__jsgb.seed(%s)"), *S.Args)); }
		else if (S.Verb == TEXT("key")) { Result = Eval(FString::Printf(TEXT("__jsgb.key(%s)"), *S.Args)); }
		else if (S.Verb == TEXT("shot")) { Capture(CaptureDir.IsEmpty() ? FPaths::ProjectSavedDir() / TEXT("JsGameBridge") / (S.Args + TEXT(".png")) : CaptureDir / (S.Args + TEXT(".png"))); }
		else if (S.Verb == TEXT("quit")) { ExitFrame = Frame + 2; }
		Bridge->Log(TEXT("log"), FString::Printf(TEXT("script %.2fs %s %s -> %s"), Rel, *S.Verb, *S.Args.Left(160), *Result.Left(800)));
	}
}

void AJsgbHost::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	++Frame;
	if (CaptureQueue.Num() && !FScreenshotRequest::IsScreenshotRequested()) { FScreenshotRequest::RequestScreenshot(CaptureQueue[0], true, false); CaptureQueue.RemoveAt(0); }
	if (bRestart || (Bridge && Bridge->bReloadRequested))
	{
		bRestart = false;
		if (ReloadStart < 0) { ReloadStart = FPlatformTime::Seconds(); ReloadBuildMs = -1; }
		StopJs();
		if (!PendingBundle.IsEmpty()) { LoadPublication(GameDir, PendingBundle); PendingBundle.Reset(); }
		StartJs();
	}
	if (!Bridge || !Bridge->OnFrame.IsBound()) { return; }
	if (Bridge->FixedStepMs > 0) { Bridge->VirtualMs += Bridge->FixedStepMs; }

	FIntPoint Size(1920, 1080);
	if (UGameViewportClient* Vp = GetWorld()->GetGameViewport()) { FVector2D S; Vp->GetViewportSize(S); if (S.X > 0) { Size = FIntPoint(S.X, S.Y); } }
	if (Size != Viewport) { Viewport = Size; Mirror->ViewportSize = Size; if (Bridge->OnViewport.IsBound()) { Bridge->OnViewport.Execute(Size.X, Size.Y); } }

	if (ReadyFrame < 0 && Bridge->bReady) { ReadyFrame = Frame; ReadySeconds = GameSeconds(); CaptureStart = ReadySeconds; Bridge->Log(TEXT("log"), FString::Printf(TEXT("game ready at host frame %lld"), Frame)); }
	RunScript();
	const double T0 = FPlatformTime::Seconds();
	Bridge->OnFrame.Execute(ReadyFrame < 0 ? 40.f : 8.f);
	JsMs += (FPlatformTime::Seconds() - T0) * 1000.0; ++TimedFrames;
	PushUI();
	// The first frame the reloaded game draws stops the reload timer.
	if (ReloadStart >= 0 && ReadyFrame >= 0 && Frame > ReadyFrame)
	{
		LastReloadMs = (FPlatformTime::Seconds() - ReloadStart) * 1000.0;
		LastBuildMs = ReloadBuildMs;
		ReloadStart = -1;
		const FString Line = LastBuildMs >= 0
			? FString::Printf(TEXT("Hot reload: build %.2f s + Unreal %.2f s = %.2f s"), LastBuildMs / 1000.0, LastReloadMs / 1000.0, (LastBuildMs + LastReloadMs) / 1000.0)
			: FString::Printf(TEXT("Hot reload: Unreal %.2f s"), LastReloadMs / 1000.0);
		Bridge->Log(TEXT("log"), Line);
		ShowReloadBanner(Line);
	}
	if (Banner.IsValid() && BannerUntil > 0 && FPlatformTime::Seconds() > BannerUntil) { Banner->SetVisibility(EVisibility::Collapsed); BannerUntil = 0; }
	if (Frame % 600 == 0)
	{
		Bridge->Log(TEXT("log"), FString::Printf(TEXT("host frame %lld: js+mirror %.2f ms, frame %.2f ms, drawn %d, pending builds %d, voices %d, js errors %d"),
			Frame, JsMs / FMath::Max(1, TimedFrames), DeltaSeconds * 1000.f, Mirror->DrawnEntities, Mirror->PendingBuilds(), Audio->ActiveVoices(), Bridge->ErrorCount));
		JsMs = 0; TimedFrames = 0;
	}
	if (!CaptureDir.IsEmpty() && CaptureFps > 0 && ReadyFrame >= 0)
	{
		// Frames are timed from the moment the game entry finished, in game seconds.
		if (CaptureStart < 0) { CaptureStart = GameSeconds(); }
		const double T = GameSeconds() - CaptureStart;
		if (T >= NextCapture)
		{
			const FString Name = FString::Printf(TEXT("frame_%05d.png"), CaptureIndex++);
			Capture(CaptureDir / Name);
			// What the mirror drew in this frame: objects drawn, objects the game drew that are missing,
			// and drawn objects still without their real material.
			CaptureTimes += FString::Printf(TEXT("%s %.3f drawn=%d missing=%d untextured=%d lines=%d sprites=%d points=%d\n"), *Name, T, Mirror->DrawnEntities, Mirror->SkippedEntities, Mirror->CompilingEntities, Mirror->LineSegmentsDrawn, Mirror->SpritesDrawn, Mirror->PointsDrawn);
			NextCapture = FMath::Max(NextCapture + 1.0 / CaptureFps, T);
			if (CaptureIndex % 20 == 0) { FFileHelper::SaveStringToFile(CaptureTimes, *(CaptureDir / TEXT("times.txt"))); }
		}
	}
	// A hard time limit, so a forgotten debugging session cannot hold the shared Unreal slot.
	if (MaxSeconds > 0 && FPlatformTime::Seconds() - HostStartSeconds > MaxSeconds && ExitFrame < 0)
	{
		Bridge->Log(TEXT("warn"), FString::Printf(TEXT("time limit of %.0f s reached; exiting"), MaxSeconds));
		ExitFrame = Frame + 1;
	}
	// Quit once every queued screenshot is written.
	if (ExitFrame > 0 && Frame >= ExitFrame && (CaptureQueue.Num() || FScreenshotRequest::IsScreenshotRequested()) && ++ExitDelays < 600) { ExitFrame = Frame + 1; }
	if (ExitFrame > 0 && Frame >= ExitFrame)
	{
		Bridge->Log(TEXT("log"), TEXT("exit frame reached"));
		if (!CaptureDir.IsEmpty()) { FFileHelper::SaveStringToFile(CaptureTimes, *(CaptureDir / TEXT("times.txt"))); }
		ExitFrame = -1;
		FGenericPlatformMisc::RequestExit(false);
	}
}

AJsgbGameMode::AJsgbGameMode()
{
	DefaultPawnClass = nullptr;
	HUDClass = nullptr;
}

void AJsgbGameMode::StartPlay()
{
	Super::StartPlay();
	GetWorld()->SpawnActor<AJsgbHost>();
}
