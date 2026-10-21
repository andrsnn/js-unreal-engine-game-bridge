#include "JsgbHost.h"
#include "ShaderPipelineCache.h"
#include "GameFramework/GameUserSettings.h"
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
#include "GenericPlatform/GenericPlatformInputDeviceMapper.h"
#include "Widgets/SWindow.h"
#include "SWebBrowser.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "WebBrowserModule.h"
#include "IWebBrowserSingleton.h"
#include "IWebBrowserWindow.h"
#include "HttpServerModule.h"
#include "IHttpRouter.h"
#include "HttpServerResponse.h"
#include "Interfaces/IPluginManager.h"
#include "HAL/FileManager.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "Misc/CommandLine.h"
#include "Misc/App.h"
#include <atomic>
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"
#include "UnrealClient.h"
#include "IImageWrapper.h"
#include "IImageWrapperModule.h"
#include "Async/Async.h"
#include "HAL/ThreadSafeCounter.h"
#include "HAL/Runnable.h"
#include "HAL/RunnableThread.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "RHI.h"
#include "Misc/Base64.h"
#include "FrameGrabber.h"
#include "Engine/GameEngine.h"
#include "RenderTimer.h"
#if PLATFORM_WINDOWS
#include "Windows/AllowWindowsPlatformTypes.h"
#include <windows.h>
#include "Windows/HideWindowsPlatformTypes.h"
#endif
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
		const AJsgbHost* H = Host.Get();
		return H && H->IsPageGame();
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
		for (int32 I = 0; I < 16; ++I) { if (E.GetKey() == PadButtons[I]) { Buttons[I] = bDown ? 1.f : 0.f; bPadSeen = true; if (bDown && !E.IsRepeat()) { H->PagePadGesture(); } return H->IsPageGame(); } }
		// A page game reads the pad through navigator.getGamepads (SendGamepads). Its stick-as-button and trigger keys would
		// otherwise reach the built-in browser as key presses with no key code, and Slate would move its focus with them.
		if (H->IsPageGame() && E.GetKey().IsGamepadKey()) { return true; }
		// F6 and F7 (with -JsgbDlssKeys) switch DLSS modes and Frame Generation while the game runs.
		if (bDown && !E.IsRepeat() && H->HandleDlssKey(E.GetKey())) { return true; }
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
	// The overlay page's own errors and notes.
	if (Json.StartsWith(TEXT("{\"type\":\"host-log\"")))
	{
		UE_LOG(LogJsgbHost, Warning, TEXT("UI overlay: %s"), *Json.Left(600));
		return;
	}
	if (Json.StartsWith(TEXT("{\"type\":\"host-css\"")))
	{
		const int32 At = Json.Find(TEXT("\"version\":"));
		if (At >= 0) { AppliedCssVersion = FCString::Atoi(*Json.Mid(At + 10, 12)); }
		return;
	}
	if (UJsgbBridge* B = Bridge) { B->RunOnJs([B, Json] { if (B->OnUIInput.IsBound()) { B->OnUIInput.Execute(Json); } }); }
}

/** The game's JavaScript on its own thread (-JsgbJsThread): it runs the game's frames at its own pace and
 *  hands each finished frame to the game thread as a snapshot, so Unreal draws without waiting for it.
 *  Needs Puerts built with THREAD_SAFE, which locks the JavaScript engine for every call into it. */
class FJsgbJsThread : public FRunnable
{
public:
	FJsgbJsThread(UJsgbBridge* InBridge, double InHz) : Bridge(InBridge), Hz(FMath::Clamp(InHz, 10.0, 240.0))
	{
		Wake = FPlatformProcess::GetSynchEventFromPool(false);
		Thread = FRunnableThread::Create(this, TEXT("JsgbJavaScript"), 0, TPri_AboveNormal);
	}
	virtual ~FJsgbJsThread() override
	{
		bStop = true; Wake->Trigger();
		if (Thread) { Thread->WaitForCompletion(); delete Thread; }
		FPlatformProcess::ReturnSynchEventToPool(Wake);
	}
	virtual uint32 Run() override
	{
		double Next = FPlatformTime::Seconds();
		while (!bStop)
		{
			const double T0 = FPlatformTime::Seconds();
			Bridge->DrainJsCommands();
			if (Bridge->OnFrame.IsBound()) { Bridge->OnFrame.Execute(Bridge->bReady ? 8.f : 40.f); }
			const double Ms = (FPlatformTime::Seconds() - T0) * 1000.0;
			{ FScopeLock Lock(&StatsLock); FrameMs += Ms; ++Frames; MaxMs = FMath::Max(MaxMs, Ms); }
			// One game frame per tick of the configured rate, and never two frames closer than a tick less 1 ms, as a
			// display's refresh paces requestAnimationFrame in a browser. Games with a frame cap skip a frame that comes
			// early (Hard Burn skips one that comes 1.5 ms early), so a frame started early to catch up was thrown away:
			// Hard Burn's fight produced 51 to 55 frames a second from 6 ms frames. The wait rounds up for the same reason.
			Next = FMath::Max(Next + 1.0 / Hz, T0 + 1.0 / Hz - 0.001);
			const double Wait = Next - FPlatformTime::Seconds();
			if (Wait > 0) { Wake->Wait(FMath::Max(1, static_cast<int32>(FMath::CeilToDouble(Wait * 1000.0)))); }
		}
		return 0;
	}
	void Poke() { Wake->Trigger(); }
	/** Average and longest frame times since the last call, and how many frames ran. */
	void TakeStats(double& OutAvg, double& OutMax, int32& OutFrames)
	{
		FScopeLock Lock(&StatsLock);
		OutFrames = Frames; OutAvg = Frames ? FrameMs / Frames : 0; OutMax = MaxMs;
		FrameMs = 0; Frames = 0; MaxMs = 0;
	}
private:
	UJsgbBridge* Bridge;
	double Hz;
	FEvent* Wake = nullptr;
	FRunnableThread* Thread = nullptr;
	TAtomic<bool> bStop{false};
	FCriticalSection StatsLock;
	double FrameMs = 0, MaxMs = 0;
	int32 Frames = 0;
};

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
	// Relative paths in publication.json are relative to the game's folder, so a copied game folder runs anywhere.
	auto InGameDir = [&Dir](const FString& P) { return FPaths::IsRelative(P) ? FPaths::ConvertRelativePathToFull(Dir / P) : P; };
	// A page game (2D WebGL, such as pixi.js) has no bundle: its own web build runs in the built-in browser.
	PageIndex.Reset();
	Pub->TryGetStringField(TEXT("page"), PageIndex);
	FString Bundle;
	Pub->TryGetStringField(TEXT("bundle"), Bundle);
	BundlePath = !OverrideBundle.IsEmpty() ? OverrideBundle : Bundle.IsEmpty() ? FString() : InGameDir(Bundle);
	Pub->TryGetStringField(TEXT("sourceCommit"), SourceCommit);
	Pub->TryGetStringField(TEXT("title"), Title);
	BundleSHA256 = BundlePath.IsEmpty() ? FString() : Sha256File(BundlePath);
	Search = Arg(TEXT("JsgbSearch="), Pub->HasField(TEXT("search")) ? Pub->GetStringField(TEXT("search")) : FString());
	PublicRoots.Reset();
	const TArray<TSharedPtr<FJsonValue>>* Roots = nullptr;
	if (Pub->TryGetArrayField(TEXT("publicRoots"), Roots)) { for (const TSharedPtr<FJsonValue>& R : *Roots) { PublicRoots.Add(InGameDir(R->AsString())); } }
	PageCss.Reset();
	if (const TSharedPtr<FJsonObject> Page = LoadJson(Dir / TEXT("page.json"))) { FFileHelper::LoadFileToString(PageCss, *(Dir / Page->GetStringField(TEXT("css")))); }
	RegistryJson.Reset();
	FFileHelper::LoadFileToString(RegistryJson, *(Dir / TEXT("registry.json")));
	// Asset overrides: overrides.json beside publication.json, or -JsgbOverrides=<file>; -JsgbOverrides=0 turns them
	// off. Each rule becomes registry asset "override:<name>", and the rules travel to the game's runtime, which
	// decides what each rule matches.
	const FString OverridesPath = Arg(TEXT("JsgbOverrides="), Dir / TEXT("overrides.json"));
	if (OverridesPath != TEXT("0") && FPaths::FileExists(OverridesPath))
	{
		TSharedPtr<FJsonObject> Reg;
		if (RegistryJson.IsEmpty() || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(RegistryJson), Reg) || !Reg) { Reg = MakeShared<FJsonObject>(); }
		const TSharedPtr<FJsonObject> Overrides = LoadJson(OverridesPath);
		const TArray<TSharedPtr<FJsonValue>>* Rules = nullptr;
		if (Overrides && Overrides->TryGetArrayField(TEXT("overrides"), Rules))
		{
			const TSharedPtr<FJsonObject>* Existing = nullptr;
			TSharedPtr<FJsonObject> Assets = Reg->TryGetObjectField(TEXT("assets"), Existing) ? *Existing : MakeShared<FJsonObject>();
			int32 Added = 0;
			for (const TSharedPtr<FJsonValue>& R : *Rules)
			{
				const TSharedPtr<FJsonObject> Rule = R.IsValid() ? R->AsObject() : nullptr;
				FString Name;
				if (Rule && Rule->TryGetStringField(TEXT("name"), Name)) { Assets->SetObjectField(TEXT("override:") + Name, Rule); ++Added; }
			}
			Reg->SetObjectField(TEXT("assets"), Assets);
			Reg->SetArrayField(TEXT("overrides"), *Rules);
			// Which Unreal effects Lumen mode adds (Runtime/src/overrides.ts effectFlags).
			const TSharedPtr<FJsonObject>* Effects = nullptr;
			if (Overrides->TryGetObjectField(TEXT("effects"), Effects)) { Reg->SetObjectField(TEXT("effects"), *Effects); }
			RegistryJson = JsonString(Reg.ToSharedRef());
			UE_LOG(LogJsgbHost, Display, TEXT("Asset overrides: %d rules from %s"), Added, *OverridesPath);
		}
	}
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

// Whether the game window is the active one, from Slate's record of Windows' activation messages, read on the game
// thread each tick. The engine's own check asks Windows for the foreground window each frame (Niagara does in editor
// builds), and that call blocked a frame for 236 ms on a locked desktop. Other threads ask too (Streamline's render
// pass), so they read the stored answer.
static std::atomic<bool> GJsgbWindowFocus{true};
static bool JsgbWindowHasFocus() { return GJsgbWindowFocus.load(std::memory_order_relaxed); }

void AJsgbHost::BeginPlay()
{
	Super::BeginPlay();
	FApp::SetHasFocusFunction(&JsgbWindowHasFocus);
#if PLATFORM_WINDOWS
	// Keep the display on while a game runs, as games do. When Windows switches an idle or locked PC's display off,
	// each switch stalls the GPU queue for 300 to 400 ms (Kernel-Power event 566 at the same second).
	SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
#endif
	UWorld* World = GetWorld();
	// Custom depth with stencil: the scene post reads it to leave fog-free surfaces unfogged.
	if (IConsoleVariable* CustomDepth = IConsoleManager::Get().FindConsoleVariable(TEXT("r.CustomDepth"))) { CustomDepth->Set(3, ECVF_SetByCode); }
	// FXAA, like a browser's MSAA, keeps no history between frames. Temporal AA smeared camera-facing
	// billboards (stars, sprites) into streaks, because their offset follows the camera.
	if (IConsoleVariable* Aa = IConsoleManager::Get().FindConsoleVariable(TEXT("r.AntiAliasingMethod"))) { Aa->Set(1, ECVF_SetByCode); }
	SetupUpscaler();
	// Garbage collection spread over frames (reachability and purging in small time slices), so a
	// collection doesn't stop one frame for tens of milliseconds.
	if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(TEXT("gc.AllowIncrementalReachability"))) { V->Set(1, ECVF_SetByCode); }
	if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(TEXT("gc.AllowIncrementalGather"))) { V->Set(1, ECVF_SetByCode); }
	if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(TEXT("gc.IncrementalReachabilityTimeLimit"))) { V->Set(0.002f, ECVF_SetByCode); }
	if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(TEXT("gc.IncrementalGatherTimeLimit"))) { V->Set(0.002f, ECVF_SetByCode); }
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
	SetupLumen();
	ApplyHandheld();
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
	ShowLoading();
	StartServer();
	if (!PageIndex.IsEmpty()) { CreatePageView(); return; }
	StartJs();
	CreateOverlay();
}

// Unreal's browser fills a key event's Windows key code but not its scan code, and Chromium on Windows derives
// KeyboardEvent.code from the scan code, so a page saw code "" for every key (WASD by code did nothing). This fills
// code from keyCode whenever Chromium left it empty.
static const TCHAR* PageKeyCodeFix = TEXT("(function(){if(window.__jsgbKeyFix)return;window.__jsgbKeyFix=1;")
	TEXT("var d=Object.getOwnPropertyDescriptor(KeyboardEvent.prototype,'code');")
	TEXT("var N={8:'Backspace',9:'Tab',13:'Enter',16:'ShiftLeft',17:'ControlLeft',18:'AltLeft',19:'Pause',20:'CapsLock',27:'Escape',32:'Space',")
	TEXT("33:'PageUp',34:'PageDown',35:'End',36:'Home',37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown',45:'Insert',46:'Delete',")
	TEXT("91:'MetaLeft',93:'ContextMenu',106:'NumpadMultiply',107:'NumpadAdd',109:'NumpadSubtract',110:'NumpadDecimal',111:'NumpadDivide',")
	TEXT("160:'ShiftLeft',161:'ShiftRight',162:'ControlLeft',163:'ControlRight',164:'AltLeft',165:'AltRight',186:'Semicolon',187:'Equal',")
	TEXT("188:'Comma',189:'Minus',190:'Period',191:'Slash',192:'Backquote',219:'BracketLeft',220:'Backslash',221:'BracketRight',222:'Quote'};")
	TEXT("Object.defineProperty(KeyboardEvent.prototype,'code',{configurable:true,enumerable:true,get:function(){var c=d.get.call(this);if(c)return c;")
	TEXT("var k=this.keyCode;if(k>=65&&k<=90)return 'Key'+String.fromCharCode(k);if(k>=48&&k<=57)return 'Digit'+(k-48);")
	TEXT("if(k>=96&&k<=105)return 'Numpad'+(k-96);if(k>=112&&k<=123)return 'F'+(k-111);")
	TEXT("if((k===16||k===17||k===18)&&this.location===2)return N[k].replace('Left','Right');return N[k]||'';}});})();");

// window.jsgb.display and the Fullscreen API inside a page game, through window.ue.jsgbpage (UJsgbPagePort); the
// browser's own fullscreen does nothing in Unreal's windowless browser.
static const TCHAR* PageDisplayApi = TEXT("(function(){var p=window.ue&&window.ue.jsgbpage;if(!p||(window.jsgb&&window.jsgb.display))return;")
	TEXT("var st={modes:[],cur:{}};function refresh(){return Promise.all([p.displaymodes(),p.displayget()]).then(function(r){")
	TEXT("try{st.modes=JSON.parse(r[0]||'[]');st.cur=JSON.parse(r[1]||'{}')}catch(e){}})}")
	TEXT("var display={supported:true,modes:function(){return st.modes},get:function(){return st.cur},set:function(c){p.displayset(JSON.stringify(c||{}));")
	TEXT("return new Promise(function(res){setTimeout(function(){refresh().then(function(){res(st.cur)})},150)})}};")
	TEXT("window.jsgb=Object.assign(window.jsgb||{},{display:display});refresh();var fs=null;")
	TEXT("Object.defineProperty(document,'fullscreenElement',{get:function(){return fs},configurable:true});")
	TEXT("Object.defineProperty(document,'fullscreenEnabled',{get:function(){return true},configurable:true});")
	TEXT("Object.defineProperty(document,'fullscreen',{get:function(){return !!fs},configurable:true});")
	TEXT("function fire(){document.dispatchEvent(new Event('fullscreenchange'))}")
	TEXT("Element.prototype.requestFullscreen=function(){fs=this;return display.set({mode:'borderless'}).then(fire)};")
	TEXT("document.exitFullscreen=function(){if(!fs)return Promise.resolve();fs=null;return display.set({mode:'windowed'}).then(fire)};")
	TEXT("window.close=function(){setTimeout(function(){p.quit()},300)};})();");

// navigator.getGamepads inside a page game: the pads Unreal reads (XInput and the rest), in the Gamepad API's standard
// layout. The host calls window.__jsgbPads with [{id, buttons: [value...], axes: [...]}] whenever a value changes, and a
// new pad fires gamepadconnected, as in a browser.
static const TCHAR* PagePadApi = TEXT("(function(){if(window.__jsgbPads)return;var pads=[];")
	TEXT("function mk(p,i){var now=performance.now();return{id:p.id,index:i,connected:true,mapping:'standard',timestamp:now,axes:p.axes.slice(),")
	TEXT("buttons:p.buttons.map(function(v){return{pressed:v>0.5,touched:v>0,value:v}}),vibrationActuator:null}}")
	TEXT("try{Object.defineProperty(navigator,'getGamepads',{configurable:true,value:function(){return pads.slice()}})}catch(e){navigator.getGamepads=function(){return pads.slice()}}")
	TEXT("window.__jsgbPads=function(list){var before=pads.length;pads=list.map(mk);")
	TEXT("for(var i=before;i<pads.length;i++){var e=new Event('gamepadconnected');e.gamepad=pads[i];window.dispatchEvent(e)}};})();");

void UJsgbPagePort::Quit()
{
	UE_LOG(LogJsgbHost, Display, TEXT("The page closed its window: quitting"));
	FPlatformMisc::RequestExit(false);
}

// Reports to the host when a Web Audio context in the page starts running, and keeps the contexts in window.__jsgbAudio.
static const TCHAR* PageAudioWatch = TEXT("(function(){var p=window.ue&&window.ue.jsgbpage,A=window.AudioContext;if(!A||!p||window.__jsgbAudio)return;window.__jsgbAudio=[];")
	TEXT("function watch(c){window.__jsgbAudio.push(c);var f=function(){if(c.state==='running')p.audiorunning()};c.addEventListener('statechange',f);f()}")
	TEXT("var W=function(o){var c=new A(o);watch(c);return c};W.prototype=A.prototype;window.AudioContext=W;if(window.webkitAudioContext)window.webkitAudioContext=W;})();");

void AJsgbHost::PagePadGesture()
{
	if (!IsPageGame() || !PageWindow.IsValid() || !PagePort || PagePort->bAudioRunning) { return; }
	const FKeyEvent Gesture(EKeys::F12, FModifierKeysState(), 0, false, 0, 0x87);
	PageWindow->OnKeyDown(Gesture);
	PageWindow->OnKeyUp(Gesture);
}

FString UJsgbPagePort::DisplayModes() { return Display ? Display->DisplayModes() : FString(TEXT("[]")); }
FString UJsgbPagePort::DisplayGet() { return Display ? Display->DisplayGet() : FString(TEXT("{}")); }
void UJsgbPagePort::DisplaySet(const FString& Json)
{
	if (!Display) { return; }
	Display->DisplaySet(Json);
	// A page game draws at the page's rate: no cap, or one above it, means the page's rate (more Unreal frames only
	// repeat page frames unevenly, which judders).
	// The cap is a console setting only, so nothing about it is saved.
	UGameUserSettings* S = GEngine ? GEngine->GetGameUserSettings() : nullptr;
	const float Limit = S ? S->GetFrameRateLimit() : 0.f;
	Cap = Limit <= 0 || Limit > PageFps ? static_cast<float>(PageFps) : Limit;
	if (IConsoleVariable* MaxFps = IConsoleManager::Get().FindConsoleVariable(TEXT("t.MaxFPS"))) { MaxFps->Set(Cap, ECVF_SetByCode); }
}

// "KeyW", "Digit1", "Space", "ArrowUp" and the like as an Unreal key, its Windows key code and its character, for
// POST /bridge/key (tests press keys through Slate, the same path as a real keyboard).
static bool KeyFromCode(const FString& Code, FKey& Key, uint32& KeyCode, uint32& Char)
{
	static const TCHAR* Digits[] = {TEXT("Zero"), TEXT("One"), TEXT("Two"), TEXT("Three"), TEXT("Four"), TEXT("Five"), TEXT("Six"), TEXT("Seven"), TEXT("Eight"), TEXT("Nine")};
	if (Code.Len() == 4 && Code.StartsWith(TEXT("Key")) && FChar::IsUpper(Code[3])) { Key = FKey(FName(*Code.Mid(3))); KeyCode = Code[3]; Char = FChar::ToLower(Code[3]); return true; }
	if (Code.Len() == 6 && Code.StartsWith(TEXT("Digit")) && FChar::IsDigit(Code[5])) { Key = FKey(Digits[Code[5] - '0']); KeyCode = Code[5]; Char = Code[5]; return true; }
	struct FNamed { const TCHAR* Code; FKey Key; uint32 Vk, Char; };
	static const FNamed Named[] = {{TEXT("Space"), EKeys::SpaceBar, 32, ' '}, {TEXT("Enter"), EKeys::Enter, 13, 13}, {TEXT("Escape"), EKeys::Escape, 27, 0},
		{TEXT("Minus"), EKeys::Hyphen, 189, '-'}, {TEXT("Equal"), EKeys::Equals, 187, '='},
		{TEXT("Tab"), EKeys::Tab, 9, 0}, {TEXT("ShiftLeft"), EKeys::LeftShift, 16, 0}, {TEXT("ControlLeft"), EKeys::LeftControl, 17, 0},
		{TEXT("ArrowUp"), EKeys::Up, 38, 0}, {TEXT("ArrowDown"), EKeys::Down, 40, 0}, {TEXT("ArrowLeft"), EKeys::Left, 37, 0}, {TEXT("ArrowRight"), EKeys::Right, 39, 0}};
	for (const FNamed& N : Named) { if (Code == N.Code) { Key = N.Key; KeyCode = N.Vk; Char = N.Char; return true; } }
	// F1 to F12 (Saltblade's hold-F1 controls box). Without these, a test's "down F1" was refused and never reached the page.
	const int32 F = Code.Len() >= 2 && Code.Len() <= 3 && Code[0] == 'F' ? FCString::Atoi(*Code.Mid(1)) : 0;
	if (F >= 1 && F <= 12 && Code.Mid(1).IsNumeric()) { Key = FKey(FName(*Code)); KeyCode = 0x6F + F; Char = 0; return true; }
	return false;
}

// The game's window. GameViewport->GetWindow() is not set yet while the host's BeginPlay runs.
static TSharedPtr<SWindow> PageGameWindow()
{
	if (const UGameEngine* Engine = Cast<UGameEngine>(GEngine)) { if (TSharedPtr<SWindow> W = Engine->GameViewportWindow.Pin()) { return W; } }
	return GEngine && GEngine->GameViewport ? GEngine->GameViewport->GetWindow() : nullptr;
}

void AJsgbHost::CreatePageView()
{
	if (!GEngine || !GEngine->GameViewport) { return; }
	if (!IWebBrowserModule::Get().IsWebModuleAvailable()) { UE_LOG(LogJsgbHost, Error, TEXT("CEF is not available, so the page game can't run")); return; }
	// Frame Generation takes the whole frame, including this page, as the image it interpolates. With the page tagged as
	// UI, generated frames would repeat it unchanged.
	if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(TEXT("r.Streamline.TagUIColorAlpha"))) { V->Set(0, ECVF_SetByCode); }
	// The off-screen page starts a frame only when Unreal ticks (CEF begin-frame scheduling). At 60 ticks a second, a
	// page frame that needs 17 ms waits for the next tick and shows for 33 ms: Unlit Worlds ran 43 fps in space and
	// planets in Unreal against 59 to 60 in Chrome at the same size and settings (RTX 4090, 2026-10-20). At 120 ticks
	// it ran 82, 63 and 61 (space, planet, dungeon); at 240 the dungeon fell to 37. Handhelds keep 60, which saves
	// their CPU and battery. -JsgbPageFps=<n> sets it.
	int32 PageFps = bHandheld ? 60 : 120;
	FParse::Value(FCommandLine::Get(), TEXT("JsgbPageFps="), PageFps);
	// Unreal draws no scene of its own here, so it shows a new page frame each time it presents: capped at the page's
	// rate, every frame on screen is a new page frame. Uncapped, each page frame stayed up for an uneven number of
	// Unreal frames (3.8 ms frames with a 2.7 ms spread on a 240 Hz display): the motion judders.
	if (IConsoleVariable* MaxFps = IConsoleManager::Get().FindConsoleVariable(TEXT("t.MaxFPS"))) { MaxFps->Set(static_cast<float>(PageFps), ECVF_SetByCode); }
	PagePort = NewObject<UJsgbPagePort>(this);
	PagePort->PageFps = PageFps;
	PagePort->Cap = PageFps;
	FParse::Value(FCommandLine::Get(), TEXT("JsgbPageLoadFps="), PageLoadFps);
	PagePort->Display = NewObject<UJsgbBridge>(this);
	PagePort->Display->DisplayFile = FPaths::ProjectSavedDir() / TEXT("JsGameBridge") / FPaths::GetCleanFilename(GameDir) / TEXT("display.json");
	PagePort->Display->RestoreDisplay();
	if (IConsoleVariable* MaxFps = IConsoleManager::Get().FindConsoleVariable(TEXT("t.MaxFPS"))) { MaxFps->Set(static_cast<float>(PageFps), ECVF_SetByCode); }
	FString PageSearch = Search, HandheldSearch;
	// -JsgbHandheldSearch=<name=value>: added to the page's query string when the handheld preset is on.
	if (bHandheld && FParse::Value(FCommandLine::Get(), TEXT("JsgbHandheldSearch="), HandheldSearch) && !HandheldSearch.IsEmpty())
	{
		PageSearch += (PageSearch.IsEmpty() ? TEXT("?") : TEXT("&")) + HandheldSearch;
	}
	// The page covers the whole window and is opaque, so on a handheld Unreal draws no scene under it: on an Intel UHD 770
	// the empty scene's TSR and post processing took GPU time the page needs. -JsgbWorld keeps it (viewport screenshots
	// need the scene drawn).
	if (bHandheld && !FParse::Param(FCommandLine::Get(), TEXT("JsgbWorld"))) { GEngine->GameViewport->bDisableWorldRendering = true; }
	const FString Url = FString::Printf(TEXT("http://127.0.0.1:%d/"), Port) + PageIndex + PageSearch;
	// The page draws in its own child window of the game window by default, as Chrome does: Chromium presents its frames
	// itself. Off-screen rendering (-JsgbPageOsr) copies every frame into an Unreal texture and waits for the GPU on the
	// game thread for each copy (Unreal's CEF helper, CopySharedTextureSync), which halved the page's frame rate on an
	// Intel UHD 770.
	// -JsgbPageNative: the page draws in its own child window of the game window, as Chrome does (Chromium presents its frames
	// itself). By default it draws off screen into an Unreal texture, where the host sets the page's scale (below).
	const bool bNativePage = FParse::Param(FCommandLine::Get(), TEXT("JsgbPageNative")) && PageGameWindow().IsValid() && PageGameWindow()->GetNativeWindow().IsValid();
	// The page's scale (devicePixelRatio). Unreal games ignore the Windows display scale, so on a 7-inch 1080p handheld at
	// 150% the page was 1920x1080 CSS pixels at scale 1, not 1280x720 at 1.5 as in Edge: menus laid out for that size put
	// buttons below the screen (the Stone Hammer's Make button) and the game drew 2.25 times the pixels.
	// -JsgbPageScale=<n> sets it; with the handheld preset it is the window height over 720 (1.5 at 1080p).
	{
		float PageScale = 0.f;
		FParse::Value(FCommandLine::Get(), TEXT("JsgbPageScale="), PageScale);
		const TSharedPtr<SWindow> GameWindow = PageGameWindow();
		// -JsgbPageScale=auto: the window height over 720 (1.5 at 1080p). Not on by default until it is checked on a 150% display.
		if (PageScale <= 0.f && FParse::Param(FCommandLine::Get(), TEXT("JsgbPageScale=auto")) && GameWindow.IsValid()) { PageScale = FMath::Clamp(FMath::RoundToFloat(GameWindow->GetClientSizeInScreen().Y / 720.f * 4.f) / 4.f, 1.f, 3.f); }
		UE_LOG(LogJsgbHost, Display, TEXT("Page scale asked %.2f (window %s, native %s)"), PageScale, GameWindow.IsValid() ? TEXT("yes") : TEXT("no"), GameWindow.IsValid() && GameWindow->GetNativeWindow().IsValid() ? TEXT("yes") : TEXT("no"));
		if (PageScale > 0.f && GameWindow.IsValid() && GameWindow->GetNativeWindow().IsValid())
		{
			GameWindow->GetNativeWindow()->SetDPIScaleFactor(PageScale);
			UE_LOG(LogJsgbHost, Display, TEXT("Page scale %.2f (window %.0fx%.0f)"), PageScale, GameWindow->GetClientSizeInScreen().X, GameWindow->GetClientSizeInScreen().Y);
		}
	}
	{
		FCreateBrowserWindowSettings Settings;
		Settings.InitialURL = Url;
		Settings.BrowserFrameRate = PageFps;
		Settings.bUseTransparency = false;
		Settings.BackgroundColor = FColor::Black;
		Settings.bShowErrorMessage = false;
		if (bNativePage) { Settings.OSWindowHandle = PageGameWindow()->GetNativeWindow()->GetOSWindowHandle(); }
		PageWindow = IWebBrowserModule::Get().GetSingleton()->CreateBrowserWindow(Settings);
	}
	SAssignNew(Browser, SWebBrowser, PageWindow).InitialURL(Url).ParentWindow(PageGameWindow())
		.ShowControls(false).ShowAddressBar(false).ShowInitialThrobber(false)
		.SupportsTransparency(false).BackgroundColor(FColor::Black).BrowserFrameRate(PageFps)
		.PopupMenuMethod(EPopupMethod::UseCurrentWindow)
		.OnLoadCompleted_Lambda([this]()
		{
			bDocumentReady = true;
			Browser->ExecuteJavascript(PageKeyCodeFix);
			Browser->ExecuteJavascript(PageDisplayApi);
			Browser->ExecuteJavascript(PagePadApi);
			if (PagePort) { PagePort->bAudioRunning = false; }
			Browser->ExecuteJavascript(PageAudioWatch);
			if (!LastPadJson.IsEmpty()) { Browser->ExecuteJavascript(TEXT("window.__jsgbPads(") + LastPadJson + TEXT(")")); }
			FSlateApplication::Get().SetAllUserFocus(Browser.ToSharedRef(), EFocusCause::SetDirectly);
			// Chromium starts Web Audio only after a user gesture, and a gamepad is not one. A real key press (F24, which
			// games don't use) gives the page that gesture, so sound plays on a handheld that only has its controller.
			if (PageWindow.IsValid())
			{
				const FKeyEvent Gesture(EKeys::F12, FModifierKeysState(), 0, false, 0, 0x87);
				PageWindow->OnKeyDown(Gesture);
				PageWindow->OnKeyUp(Gesture);
				PageWindow->OnFocus(true, false);
			}
			UE_LOG(LogJsgbHost, Display, TEXT("Page game loaded"));
		})
		.OnLoadError_Lambda([Url]() { UE_LOG(LogJsgbHost, Error, TEXT("Page game failed to load from %s"), *Url); })
		.OnConsoleMessage_Lambda([](const FString& Message, const FString& Source, int32 Line, EWebBrowserConsoleLogSeverity Severity)
		{
			UE_LOG(LogJsgbHost, Display, TEXT("Page console %d %s:%d %s"), static_cast<int32>(Severity), *Source, Line, *Message.Left(2048));
		})
		.OnBeforePopup_Lambda([](FString, FString) { return true; });
	Browser->BindUObject(TEXT("jsgbpage"), PagePort, true);
	GEngine->GameViewport->AddViewportWidgetContent(Browser.ToSharedRef(), 100);
	FSlateApplication::Get().SetAllUserFocus(Browser.ToSharedRef(), EFocusCause::SetDirectly);
	if (APlayerController* Pc = UGameplayStatics::GetPlayerController(GetWorld(), 0))
	{
		FInputModeUIOnly Mode;
		Mode.SetWidgetToFocus(Browser);
		Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
		Pc->SetInputMode(Mode);
	}
	UE_LOG(LogJsgbHost, Display, TEXT("Page game %s at %s, drawn by the built-in browser at up to %d frames per second"), *Title, *Url, PageFps);
}

void AJsgbHost::StartJs()
{
	Bridge = NewObject<UJsgbBridge>(this);
	Bridge->Mirror = Mirror;
	Bridge->Audio = Audio;
	PublishGraphics();
	Mirror->Bridge = Bridge;
	Audio->Bridge = Bridge;
	if (UIPort) { UIPort->Bridge = Bridge; UIPort->AppliedUIVersion = -1; }
	Bridge->StartSeconds = FPlatformTime::Seconds();
	Bridge->DisplayFile = FPaths::ProjectSavedDir() / TEXT("JsGameBridge") / FPaths::GetCleanFilename(GameDir) / TEXT("display.json");
	// Once per launch (a hot reload keeps the window as it is).
	if (Frame == 0) { Bridge->RestoreDisplay(); } else { Bridge->UpdateDisplayInfo(); }
	double FixedFps = 0;
	if (FParse::Value(FCommandLine::Get(), TEXT("JsgbFixedFps="), FixedFps) && FixedFps > 0) { Bridge->FixedStepMs = 1000.0 / FixedFps; }
	Bridge->Search = Search;
	Bridge->Trace = FParse::Param(FCommandLine::Get(), TEXT("JsgbTraceMirror"));
	Mirror->bTrace = Bridge->Trace;
	FParse::Value(FCommandLine::Get(), TEXT("JsgbSeed="), Bridge->Seed);
	// Web Workers run on their own threads unless -JsgbGameThreadWorkers asks for the old single-thread mode.
	if (!FParse::Param(FCommandLine::Get(), TEXT("JsgbGameThreadWorkers"))) { FFileHelper::LoadFileToString(Bridge->WorkerRuntime, *(GameDir / TEXT("jsgb/worker-runtime.js"))); }
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
	// -JsgbInspect=<port> opens the V8 inspector, so Tools/profile-js.mjs can record a CPU profile of the game in Unreal.
	int32 InspectPort = -1;
	FParse::Value(FCommandLine::Get(), TEXT("JsgbInspect="), InspectPort);
	JsEnv = MakeShared<PUERTS_NAMESPACE::FJsEnv>(std::make_shared<FJsgbModuleLoader>(), std::make_shared<PUERTS_NAMESPACE::FDefaultLogger>(), InspectPort, nullptr, TEXT("--max-old-space-size=8192"));
	TArray<TPair<FString, UObject*>> Args;
	Args.Add(TPair<FString, UObject*>(TEXT("Bridge"), Bridge));
	JsEnv->Start(Bootstrap, Args);
	Bridge->Log(TEXT("log"), FString::Printf(TEXT("js env started in %.0f ms (%s), frame bound=%d"), (FPlatformTime::Seconds() - T0) * 1000.0, *BundlePath, Bridge->OnFrame.IsBound() ? 1 : 0));
	Viewport = FIntPoint::ZeroValue;
	ReadyFrame = -1;
	PushedUIVersion = -1;
	if (Browser.IsValid() && bDocumentReady) { Browser->ExecuteJavascript(TEXT("window.JsGameUI&&window.JsGameUI.reset()")); }
#ifdef THREAD_SAFE
	// Deterministic captures (fixed steps) keep the JavaScript on the game thread.
	if (FParse::Param(FCommandLine::Get(), TEXT("JsgbJsThread")) && Bridge->FixedStepMs <= 0 && Bridge->OnFrame.IsBound())
	{
		double Hz = 60;
		FParse::Value(FCommandLine::Get(), TEXT("JsgbJsHz="), Hz);
		Bridge->bJsThread = true;
		Mirror->bInterpolate = !FParse::Param(FCommandLine::Get(), TEXT("JsgbNoInterpolation"));
		LastSnapshot = 0; SnapshotInterval = 1.0 / Hz;
		JsThread = MakeShared<FJsgbJsThread>(Bridge, Hz);
		Bridge->Log(TEXT("log"), FString::Printf(TEXT("JavaScript runs on its own thread at up to %.0f frames per second"), Hz));
	}
#else
	if (FParse::Param(FCommandLine::Get(), TEXT("JsgbJsThread"))) { Bridge->Log(TEXT("warn"), TEXT("-JsgbJsThread needs Puerts built with THREAD_SAFE (ThreadSafe = true in JsEnv.Build.cs); JavaScript stays on the game thread")); }
#endif
}

void AJsgbHost::StopJs()
{
	// The JavaScript thread stops first, so nothing runs JavaScript while the engine is torn down.
	JsThread.Reset();
	if (Bridge)
	{
		Bridge->DrainGameCommands();
		Bridge->bJsThread = false;
		Mirror->bInterpolate = false;
		Bridge->StopWorkers();
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
	const FString Html = TEXT("<!doctype html><html><head><meta charset='utf-8'><base href='") + Origin + TEXT("'><title>") + Title + TEXT("</title><style id='jsgb-page-css'>") + PageCss +
		TEXT("</style><style>html,body{background:transparent!important;overflow:hidden!important}::-webkit-scrollbar{display:none}canvas:not([data-jsgb-pixels]){background:transparent!important;opacity:0!important}</style><script>") + Client + TEXT("</script></head><body></body></html>");
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

// A loading screen over the whole window while the game's JavaScript and files load: its name, a bar that moves,
// and how many files it has read. It goes once the game shows something itself: its own HTML in the overlay (often
// its own loading screen), a drawn scene, or for a page game the loaded page.
void AJsgbHost::ShowLoading()
{
	if (Loading.IsValid() || !GEngine || !GEngine->GameViewport || FParse::Param(FCommandLine::Get(), TEXT("JsgbNoLoadingScreen"))) { return; }
	LoadingStart = FPlatformTime::Seconds();
	// The package's recorded pipeline states (a bundled pipeline cache) compile on this PC's GPU driver while the
	// loading screen is up, as fast as they can, so no draw stops to compile one later.
	FShaderPipelineCache::SetBatchMode(FShaderPipelineCache::BatchMode::Fast);
	FShaderPipelineCache::ResumeBatching();
	const FString Name = Title.IsEmpty() ? FString(TEXT("Loading")) : Title;
	auto Phase = [this]() { return static_cast<float>(FMath::Fmod((FPlatformTime::Seconds() - LoadingStart) * 0.6, 1.0)); };
	Loading = SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(0.02f, 0.025f, 0.035f, 1.f))
		.HAlign(HAlign_Center).VAlign(VAlign_Center).Visibility(EVisibility::HitTestInvisible)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 0, 0, 18)
			[
				SNew(STextBlock).Text(FText::FromString(Name)).Font(FCoreStyle::GetDefaultFontStyle("Bold", 34)).ColorAndOpacity(FLinearColor(0.92f, 0.94f, 0.97f))
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(SBox).WidthOverride(420.f).HeightOverride(6.f)
				[
					SNew(SOverlay)
					+ SOverlay::Slot()[SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(1.f, 1.f, 1.f, 0.12f))]
					+ SOverlay::Slot().HAlign(HAlign_Left)
					.Padding(TAttribute<FMargin>::CreateLambda([Phase]() { return FMargin(FMath::Max(0.f, Phase() * 520.f - 120.f), 0, 0, 0); }))
					[
						SNew(SBox).WidthOverride(TAttribute<FOptionalSize>::CreateLambda([Phase]() { const float X = Phase() * 520.f - 120.f; return FOptionalSize(FMath::Clamp(FMath::Min(120.f, 120.f + X), 0.f, FMath::Max(0.f, 420.f - X))); }))
						[
							SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(0.49f, 0.78f, 1.f))
						]
					]
				]
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 14, 0, 0)
			[
				SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Regular", 14)).ColorAndOpacity(FLinearColor(0.6f, 0.65f, 0.72f))
				.Text(TAttribute<FText>::CreateLambda([this]()
				{
					const int32 Files = Bridge ? Bridge->FilesRead.load() : 0;
					if (FShaderPipelineCache::IsPrecompiling())
					{
						return FText::FromString(FString::Printf(TEXT("Preparing shaders for this PC, %u left"), FShaderPipelineCache::NumPrecompilesRemaining()));
					}
					return FText::FromString(Files > 0 ? FString::Printf(TEXT("Loading, %d files read"), Files) : FString(TEXT("Starting")));
				}))
			]
		];
	// Above the game view and the overlay browser, below the frame rate readout.
	GEngine->GameViewport->AddViewportWidgetContent(Loading.ToSharedRef(), 250);
}

void AJsgbHost::UpdateLoading()
{
	if (!Loading.IsValid()) { return; }
	const bool bPage = !PageIndex.IsEmpty();
	const bool bShown = bPage ? bDocumentReady
		: (UIPort && UIPort->AppliedUIVersion > 0) || (Mirror && Mirror->DrawnEntities > 0) || (Bridge && Bridge->bReady && ReadyFrame >= 0);
	// It stays until the pipeline cache is compiled too; two minutes at most, so a game that never reports anything
	// isn't hidden behind it.
	if ((!bShown || FShaderPipelineCache::IsPrecompiling()) && FPlatformTime::Seconds() - LoadingStart < 120.0) { return; }
	FShaderPipelineCache::SetBatchMode(FShaderPipelineCache::BatchMode::Background);
	if (GEngine && GEngine->GameViewport) { GEngine->GameViewport->RemoveViewportWidgetContent(Loading.ToSharedRef()); }
	Loading.Reset();
	UE_LOG(LogJsgbHost, Display, TEXT("Loading screen shown for %.1f s"), FPlatformTime::Seconds() - LoadingStart);
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
	if (!Browser.IsValid() || !bDocumentReady || !Bridge) { return; }
	if (Bridge->UIVersion != PushedUIVersion)
	{
		PushedUIVersion = Bridge->UIVersion;
		auto Packet = MakeShared<FJsonObject>();
		Packet->SetStringField(TEXT("html"), Bridge->UIHtml);
		Browser->ExecuteJavascript(TEXT("window.JsGameUI&&window.JsGameUI.apply((") + JsonString(Packet) + FString::Printf(TEXT(").html, %d)"), PushedUIVersion));
	}
	for (const TPair<FString, UJsgbBridge::FUICanvas>& C : Bridge->UICanvases)
	{
		Browser->ExecuteJavascript(FString::Printf(TEXT("window.JsGameUI&&window.JsGameUI.canvas&&window.JsGameUI.canvas('%s',%d,%d,'%s')"), *C.Key, C.Value.Width, C.Value.Height, *FBase64::Encode(C.Value.Rgba)));
	}
	Bridge->UICanvases.Reset();
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
			O->SetBoolField(TEXT("ready"), H->Bridge ? H->Bridge->bReady && !H->bRestart : !H->PageIndex.IsEmpty() && H->bDocumentReady);
			O->SetNumberField(TEXT("hostFrames"), H->Frame);
			O->SetNumberField(TEXT("lastReloadMs"), H->ReloadStart >= 0 ? -1 : H->LastReloadMs);
			O->SetNumberField(TEXT("lastBuildMs"), H->LastBuildMs);
			O->SetNumberField(TEXT("cssVersion"), H->CssVersion);
			O->SetNumberField(TEXT("cssAppliedVersion"), H->UIPort ? H->UIPort->AppliedCssVersion : -1);
			O->SetNumberField(TEXT("lastCssMs"), H->CssStart >= 0 ? -1 : H->LastCssMs);
			O->SetNumberField(TEXT("recordedFrames"), H->RecordIndex);
			O->SetStringField(TEXT("upscaler"), H->Upscaler);
			O->SetNumberField(TEXT("fps"), H->HudFps);
			O->SetNumberField(TEXT("presentedFps"), H->HudPresentedFps);
			O->SetNumberField(TEXT("gpuMs"), FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles()));
			O->SetNumberField(TEXT("sceneFrames"), H->Bridge ? H->Bridge->SceneFrames : 0);
			O->SetNumberField(TEXT("drawn"), H->Mirror->DrawnEntities);
			O->SetNumberField(TEXT("pendingBuilds"), H->Mirror->PendingBuilds());
			O->SetNumberField(TEXT("jsErrors"), H->Bridge ? H->Bridge->ErrorCount : 0);
			O->SetNumberField(TEXT("uiVersion"), H->Bridge ? H->Bridge->UIVersion : 0);
			O->SetNumberField(TEXT("uiLayoutMessages"), H->UIPort ? H->UIPort->LayoutMessages : 0);
			O->SetNumberField(TEXT("uiAppliedVersion"), H->UIPort ? H->UIPort->AppliedUIVersion : -1);
			O->SetNumberField(TEXT("voicesStarted"), H->Audio->StartedVoices);
			O->SetNumberField(TEXT("voicesActive"), H->Audio->ActiveVoices());
			O->SetNumberField(TEXT("voicesUnplayable"), H->Audio->UnplayableVoices);
			O->SetNumberField(TEXT("memoryMB"), static_cast<double>(FPlatformMemory::GetStats().UsedPhysical) / (1024.0 * 1024.0));
			O->SetNumberField(TEXT("jsMs"), H->TimedFrames ? H->JsMs / H->TimedFrames : 0);
			Json(O);
			return true;
		}
		if (Route == TEXT("/bridge/frametimes"))
		{
			// Every frame time in ms since the last read, then cleared: tools compute minimum and 1% low FPS from it.
			FString Text = TEXT("[");
			for (int32 I = 0; I < H->FrameTimesMs.Num(); ++I) { if (I) { Text += TEXT(","); } Text += FString::Printf(TEXT("%.2f"), H->FrameTimesMs[I]); }
			Text += TEXT("]");
			H->FrameTimesMs.Reset();
			Done(FHttpServerResponse::Create(Text, TEXT("application/json")));
			return true;
		}
		if (Route == TEXT("/bridge/describe"))
		{
			const FString Request = Body(R);
			if (Request.StartsWith(TEXT("hide:"))) { H->Mirror->DebugHiddenKinds = FCString::Atoi(*Request.Mid(5)); }
			FString Lo, Hi;
			if (Request.StartsWith(TEXT("hideids:")) && Request.Mid(8).Split(TEXT("-"), &Lo, &Hi)) { H->Mirror->DebugHiddenIds = FIntPoint(FCString::Atoi(*Lo), FCString::Atoi(*Hi)); }
			TUniquePtr<FHttpServerResponse> Resp = FHttpServerResponse::Create(H->Mirror->Describe(Request.StartsWith(TEXT("hide")) ? 0 : FCString::Atoi(*Request)), TEXT("application/json"));
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
		if (Route == TEXT("/bridge/css") && bPost)
		{
			// A stylesheet-only edit: the overlay swaps the page CSS and the game keeps running.
			TSharedPtr<FJsonObject> In;
			FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body(R)), In);
			H->SwapCss(In && In->HasField(TEXT("buildMs")) ? In->GetNumberField(TEXT("buildMs")) : -1);
			auto O = MakeShared<FJsonObject>();
			O->SetNumberField(TEXT("cssVersion"), H->CssVersion);
			Json(O, EHttpServerResponseCodes::Accepted);
			return true;
		}
		if (Route == TEXT("/bridge/record") && bPost)
		{
			if (!bRemote) { Done(FHttpServerResponse::Error(EHttpServerResponseCodes::Forbidden, TEXT("start Unreal with -JsgbAllowRemote"))); return true; }
			// "<dir>" or "<dir>|<fps>" starts recording, an empty body stops it.
			FString Dir = Body(R).TrimStartAndEnd(), Fps;
			Dir.Split(TEXT("|"), &Dir, &Fps);
			auto O = MakeShared<FJsonObject>();
			if (Dir.IsEmpty()) { O->SetNumberField(TEXT("frames"), H->RecordIndex); H->StopRecording(); }
			else { H->StartRecording(Dir, Fps.IsEmpty() ? 30.0 : FCString::Atod(*Fps)); }
			O->SetBoolField(TEXT("recording"), H->IsRecording());
			Json(O);
			return true;
		}
		if ((Route == TEXT("/bridge/key") || Route == TEXT("/bridge/pagejs")) && bPost)
		{
			if (!bRemote) { Done(FHttpServerResponse::Error(EHttpServerResponseCodes::Forbidden, TEXT("start Unreal with -JsgbAllowRemote"))); return true; }
			auto O = MakeShared<FJsonObject>();
			const FString In = Body(R).TrimStartAndEnd();
			if (Route == TEXT("/bridge/pagejs")) { if (H->Browser.IsValid()) { H->Browser->ExecuteJavascript(In); } O->SetBoolField(TEXT("sent"), H->Browser.IsValid()); }
			else
			{
				// "down KeyW" or "up KeyW", through Slate like a real key press; "click 0.5 0.5" clicks that point of the window
				// (fractions of its width and height) with the left mouse button.
				// Real mouse wheel input for recorded play checks, through the same Slate route as hardware.
				if (In.StartsWith(TEXT("wheel ")) && GEngine && GEngine->GameViewport && GEngine->GameViewport->GetWindow().IsValid())
				{
					TArray<FString> Parts; In.ParseIntoArrayWS(Parts);
					const TSharedPtr<SWindow> Window = GEngine->GameViewport->GetWindow();
					const FVector2D At = Window->GetPositionInScreen() + Window->GetClientSizeInScreen() * FVector2D(Parts.Num() > 3 ? FCString::Atod(*Parts[2]) : 0.5, Parts.Num() > 3 ? FCString::Atod(*Parts[3]) : 0.5);
					FSlateApplication::Get().SetCursorPos(At);
					FSlateApplication::Get().ProcessMouseWheelOrGestureEvent(FPointerEvent(0, At, At, TSet<FKey>(), EKeys::Invalid, Parts.Num() > 1 ? FCString::Atof(*Parts[1]) : 0.f, FSlateApplication::Get().GetModifierKeys()), nullptr);
					O->SetBoolField(TEXT("accepted"), true); Json(O); return true;
				}
				FString Type, Code;
				if (In.StartsWith(TEXT("click ")) && GEngine && GEngine->GameViewport && GEngine->GameViewport->GetWindow().IsValid())
				{
					TArray<FString> Parts;
					In.ParseIntoArrayWS(Parts);
					const TSharedPtr<SWindow> Window = GEngine->GameViewport->GetWindow();
					const FVector2D At = Window->GetPositionInScreen() + Window->GetClientSizeInScreen() * FVector2D(Parts.Num() > 2 ? FCString::Atod(*Parts[1]) : 0.5, Parts.Num() > 2 ? FCString::Atod(*Parts[2]) : 0.5);
					FSlateApplication::Get().SetCursorPos(At);
					const TSet<FKey> Pressed = {EKeys::LeftMouseButton};
					FSlateApplication::Get().ProcessMouseButtonDownEvent(nullptr, FPointerEvent(0, At, At, Pressed, EKeys::LeftMouseButton, 0, FSlateApplication::Get().GetModifierKeys()));
					FSlateApplication::Get().ProcessMouseButtonUpEvent(FPointerEvent(0, At, At, TSet<FKey>(), EKeys::LeftMouseButton, 0, FSlateApplication::Get().GetModifierKeys()));
					O->SetBoolField(TEXT("accepted"), true);
					Json(O);
					return true;
				}
				// "pad Gamepad_FaceButton_Bottom down" or "... up", "pad Gamepad_LeftX 0.8": a controller through the same Slate entry
				// points Unreal's XInput reader calls (OnControllerButtonPressed, OnControllerButtonReleased, OnControllerAnalog).
				if (In.StartsWith(TEXT("pad ")))
				{
					TArray<FString> Parts;
					In.ParseIntoArrayWS(Parts);
					const bool bOk = Parts.Num() == 3;
					if (bOk)
					{
						const FName Name(*Parts[1]);
						const FPlatformUserId User = IPlatformInputDeviceMapper::Get().GetPrimaryPlatformUser();
						const FInputDeviceId Device = IPlatformInputDeviceMapper::Get().GetDefaultInputDevice();
						if (Parts[2] == TEXT("down")) { FSlateApplication::Get().OnControllerButtonPressed(Name, User, Device, false); }
						else if (Parts[2] == TEXT("up")) { FSlateApplication::Get().OnControllerButtonReleased(Name, User, Device, false); }
						else { FSlateApplication::Get().OnControllerAnalog(Name, User, Device, FCString::Atof(*Parts[2])); }
					}
					O->SetBoolField(TEXT("accepted"), bOk);
					Json(O);
					return true;
				}
				FKey Key; uint32 KeyCode = 0, Char = 0;
				const bool bKnown = In.Split(TEXT(" "), &Type, &Code) && KeyFromCode(Code, Key, KeyCode, Char);
				if (bKnown && Type == TEXT("down"))
				{
					FSlateApplication::Get().ProcessKeyDownEvent(FKeyEvent(Key, FSlateApplication::Get().GetModifierKeys(), 0, false, Char, KeyCode));
					if (Char >= 32) { FSlateApplication::Get().ProcessKeyCharEvent(FCharacterEvent(static_cast<TCHAR>(Char), FSlateApplication::Get().GetModifierKeys(), 0, false)); }
				}
				else if (bKnown && Type == TEXT("up")) { FSlateApplication::Get().ProcessKeyUpEvent(FKeyEvent(Key, FSlateApplication::Get().GetModifierKeys(), 0, false, Char, KeyCode)); }
				O->SetBoolField(TEXT("accepted"), bKnown);
			}
			Json(O);
			return true;
		}
		if ((Route == TEXT("/bridge/eval") || Route == TEXT("/bridge/input") || Route == TEXT("/bridge/capture") || Route == TEXT("/bridge/close")) && bPost)
		{
			if (!bRemote) { Done(FHttpServerResponse::Error(EHttpServerResponseCodes::Forbidden, TEXT("start Unreal with -JsgbAllowRemote"))); return true; }
			auto O = MakeShared<FJsonObject>();
			if (Route == TEXT("/bridge/eval")) { O->SetStringField(TEXT("result"), H->Eval(Body(R))); }
			else if (Route == TEXT("/bridge/input")) { if (H->UIPort) { H->UIPort->SendInput(Body(R)); } else if (UJsgbBridge* B = H->Bridge) { const FString In = Body(R); B->RunOnJs([B, In] { if (B->OnUIInput.IsBound()) { B->OnUIInput.Execute(In); } }); } O->SetBoolField(TEXT("accepted"), true); }
			else if (Route == TEXT("/bridge/capture")) { const FString Path = Body(R).TrimStartAndEnd(); H->Capture(Path); O->SetStringField(TEXT("path"), Path); }
			else { O->SetBoolField(TEXT("closing"), true); FPlatformMisc::RequestExit(false); }
			Json(O);
			return true;
		}
		if (R.Verb == EHttpServerRequestVerbs::VERB_GET && !Route.StartsWith(TEXT("/bridge/")) && (H->Bridge || !H->PageIndex.IsEmpty()))
		{
			// The overlay's page loads images and fonts from the web build's site root. A page game loads everything from
			// its public roots, in order.
			FArrayBufferValue File;
			if (H->Bridge) { File = H->Bridge->ReadFile(Route); }
			else if (!Route.Contains(TEXT("..")))
			{
				H->LastPageFile = FPlatformTime::Seconds();
				const FString Rel = Route == TEXT("/") ? H->PageIndex : Route.RightChop(1);
				for (const FString& Root : H->PublicRoots) { if (FFileHelper::LoadFileToArray(File.Data, *(Root / Rel), FILEREAD_Silent)) { break; } }
				// page-init.js beside publication.json runs in the page before any of the game's own scripts (for example to
				// give a first launch settings that suit the Unreal window).
				FString Init;
				if (Rel == H->PageIndex && File.Data.Num() > 0 && FFileHelper::LoadFileToString(Init, *(H->GameDir / TEXT("page-init.js"))))
				{
					FString Html;
					FFileHelper::BufferToString(Html, File.Data.GetData(), File.Data.Num());
					const int32 At = Html.Find(TEXT("<head>"));
					if (At != INDEX_NONE)
					{
						Html.InsertAt(At + 6, TEXT("<script>") + Init + TEXT("</script>"));
						const FTCHARToUTF8 Utf8(*Html);
						File.Data = TArray<uint8>(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length());
					}
				}
			}
			if (File.Data.Num() == 0) { Done(FHttpServerResponse::Error(EHttpServerResponseCodes::NotFound)); return true; }
			const FString Ext = FPaths::GetExtension(Route).ToLower();
			static const TMap<FString, FString> Mime = {{TEXT("png"), TEXT("image/png")}, {TEXT("jpg"), TEXT("image/jpeg")}, {TEXT("jpeg"), TEXT("image/jpeg")}, {TEXT("webp"), TEXT("image/webp")},
				{TEXT("gif"), TEXT("image/gif")}, {TEXT("svg"), TEXT("image/svg+xml")}, {TEXT("woff2"), TEXT("font/woff2")}, {TEXT("woff"), TEXT("font/woff")}, {TEXT("ttf"), TEXT("font/ttf")},
				{TEXT("otf"), TEXT("font/otf")}, {TEXT("css"), TEXT("text/css")}, {TEXT("json"), TEXT("application/json")}, {TEXT("ogg"), TEXT("audio/ogg")}, {TEXT("mp3"), TEXT("audio/mpeg")},
				{TEXT("html"), TEXT("text/html")}, {TEXT("js"), TEXT("text/javascript")}, {TEXT("mjs"), TEXT("text/javascript")}, {TEXT("wasm"), TEXT("application/wasm")},
				{TEXT("wav"), TEXT("audio/wav")}, {TEXT("m4a"), TEXT("audio/mp4")}, {TEXT("mp4"), TEXT("video/mp4")}, {TEXT("webm"), TEXT("video/webm")}, {TEXT("ktx2"), TEXT("image/ktx2")}};
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
	StopRecording();
#if PLATFORM_WINDOWS
	SetThreadExecutionState(ES_CONTINUOUS);
#endif
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

// Input goes to the game's JavaScript on whichever thread runs it.
void AJsgbHost::SendKey(const FString& Type, const FString& Code, bool bRepeat) { if (UJsgbBridge* B = Bridge) { B->RunOnJs([B, Type, Code, bRepeat] { if (B->OnKey.IsBound()) { B->OnKey.Execute(Type, Code, bRepeat); } }); } }
void AJsgbHost::SendMouse(const FString& Type, float X, float Y, int32 Button, int32 Buttons, float DX, float DY) { if (UJsgbBridge* B = Bridge) { B->RunOnJs([=] { if (B->OnMouse.IsBound()) { B->OnMouse.Execute(Type, X, Y, Button, Buttons, DX, DY); } }); } }
void AJsgbHost::SendWheel(float DeltaY) { if (UJsgbBridge* B = Bridge) { B->RunOnJs([B, DeltaY] { if (B->OnWheel.IsBound()) { B->OnWheel.Execute(DeltaY); } }); } }
void AJsgbHost::SendGamepads(const FString& Json)
{
	// A page game: Unreal's pad state goes into the page's navigator.getGamepads (PagePadApi). Unreal's built-in browser
	// gets no gamepads of its own.
	if (IsPageGame())
	{
		LastPadJson = Json;
		if (Browser.IsValid() && bDocumentReady) { Browser->ExecuteJavascript(TEXT("window.__jsgbPads&&window.__jsgbPads(") + Json + TEXT(")")); }
		return;
	}
	SendGamepadsToJs(Json);
}
void AJsgbHost::SendGamepadsToJs(const FString& Json) { if (UJsgbBridge* B = Bridge) { B->RunOnJs([B, Json] { if (B->OnGamepads.IsBound()) { B->OnGamepads.Execute(Json); } }); } }
FString AJsgbHost::Eval(const FString& Source)
{
	if (!Bridge) { return TEXT("ERR no js"); }
	if (!Bridge->bJsThread) { return Bridge->OnEval.IsBound() ? Bridge->OnEval.Execute(Source) : FString(TEXT("ERR no js")); }
	// On the JavaScript thread: wait for its next turn (up to 10 s) for the answer.
	struct FAnswer { FString Text; FEvent* Done = FPlatformProcess::GetSynchEventFromPool(true); ~FAnswer() { FPlatformProcess::ReturnSynchEventToPool(Done); } };
	TSharedRef<FAnswer, ESPMode::ThreadSafe> Answer = MakeShared<FAnswer, ESPMode::ThreadSafe>();
	UJsgbBridge* B = Bridge;
	B->RunOnJs([B, Source, Answer] { Answer->Text = B->OnEval.IsBound() ? B->OnEval.Execute(Source) : FString(TEXT("ERR no js")); Answer->Done->Trigger(); });
	if (JsThread) { JsThread->Poke(); }
	return Answer->Done->Wait(10000) ? Answer->Text : FString(TEXT("ERR the JavaScript thread did not answer within 10 s"));
}
TSharedRef<AJsgbHost::FAnswer> AJsgbHost::Ask(const FString& Source)
{
	TSharedRef<FAnswer> Answer = MakeShared<FAnswer>();
	UJsgbBridge* B = Bridge;
	if (!B || !B->bJsThread) { Answer->Text = Eval(Source); Answer->bDone = true; return Answer; }
	B->RunOnJs([B, Source, Answer] { Answer->Text = B->OnEval.IsBound() ? B->OnEval.Execute(Source) : FString(TEXT("ERR no js")); Answer->bDone = true; });
	if (JsThread) { JsThread->Poke(); }
	return Answer;
}
double AJsgbHost::GameSeconds() const { return Bridge ? Bridge->NowMs() / 1000.0 : 0.0; }

// Upscaling and frame generation, chosen on the command line:
//   -JsgbDLSS=dlaa|quality|balanced|performance|ultra   NVIDIA DLSS Super Resolution (DLAA renders at full resolution)
//   -JsgbDLSS=5                                          DLSS 5 Neural Rendering where it can run, else DLSS 4.5 DLAA
//   -JsgbTSR=<screen percentage>                         Unreal's TSR, on any GPU
//   -JsgbFrameGen[=2|3|4]                                DLSS Frame Generation, 2x by default (RTX 40 and later, needs a
//                                                        window); 3x and 4x are Multi Frame Generation on RTX 50 GPUs
//   -JsgbVibrance=<0..1>                                 RTX Dynamic Vibrance
// DLSS needs the NVIDIA DLSS plugin in the host project and an NVIDIA RTX GPU. Without them the same
// render scale runs through TSR instead. With none of these, the host keeps FXAA at full resolution.
static void SetCVar(const TCHAR* Name, const FString& Value)
{
	if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(Name)) { V->Set(*Value, ECVF_SetByCode); }
	else { UE_LOG(LogJsgbHost, Warning, TEXT("Console variable %s is missing; is its plugin enabled?"), Name); }
}

// RTX 50 GPUs generate up to three frames per rendered frame (Multi Frame Generation, 4x); RTX 40 GPUs one (2x).
static int32 MaxGeneratedFrames() { return IsRHIDeviceNVIDIA() && FString(GRHIAdapterName).Contains(TEXT("RTX 50")) ? 3 : 1; }

// DLSS 5 Neural Rendering needs an RTX 50 series GPU, GeForce driver 616.64 or newer (its launch driver), and an
// Unreal integration from NVIDIA. NVIDIA's Unreal plugin (DLSS 4.5, plugin 8.8.0) has none, and NVIDIA has published no
// DLSS 5 SDK or plugin for developers, so today this reports why it can't run and the host uses DLSS 4.5.
bool AJsgbHost::NeuralRenderingCheck(FString& Why, FString& Short) const
{
	TArray<FString> Missing, Needs;
	const FString Gpu = GRHIAdapterName;
	if (!IsRHIDeviceNVIDIA() || !Gpu.Contains(TEXT("RTX 50"))) { Missing.Add(FString::Printf(TEXT("the GPU is %s, and DLSS 5 needs an RTX 50 series GPU"), *Gpu)); Needs.Add(TEXT("an RTX 50 GPU")); }
	const FString Driver = GRHIAdapterUserDriverVersion;
	FString Major, Minor;
	const bool bParsed = Driver.Split(TEXT("."), &Major, &Minor);
	const double Version = bParsed ? FCString::Atod(*Major) + FCString::Atod(*Minor.Left(2)) / 100.0 : 0.0;
	if (Version < 616.64 - 1e-6) { Missing.Add(FString::Printf(TEXT("the driver is %s, and DLSS 5 needs 616.64 or newer"), Driver.IsEmpty() ? TEXT("unknown") : *Driver)); Needs.Add(TEXT("driver 616.64")); }
	const TSharedPtr<IPlugin> Dlss = IPluginManager::Get().FindPlugin(TEXT("DLSS"));
	Missing.Add(FString::Printf(TEXT("NVIDIA's DLSS plugin for Unreal (%s) has no DLSS 5 Neural Rendering, and NVIDIA has released none for developers"),
		Dlss.IsValid() ? *FString::Printf(TEXT("version %s"), *Dlss->GetDescriptor().VersionName) : TEXT("not installed")));
	Needs.Add(TEXT("NVIDIA's DLSS 5 plugin for Unreal"));
	Why = FString::Join(Missing, TEXT("; "));
	Short = TEXT("DLSS 5 needs ") + FString::Join(Needs, TEXT(", ")) + TEXT(" (see the log)");
	return false;
}

void AJsgbHost::SetupUpscaler()
{
	FString Dlss, Tsr;
	FParse::Value(FCommandLine::Get(), TEXT("JsgbDLSS="), Dlss);
	FParse::Value(FCommandLine::Get(), TEXT("JsgbTSR="), Tsr);
	int32 FrameGenFactor = 0;
	bFrameGen = FParse::Param(FCommandLine::Get(), TEXT("JsgbFrameGen")) || FParse::Value(FCommandLine::Get(), TEXT("JsgbFrameGen="), FrameGenFactor);
	FrameGenFrames = FMath::Clamp(FrameGenFactor - 1, 1, MaxGeneratedFrames());
	UE_LOG(LogJsgbHost, Display, TEXT("GPU %s, driver %s"), *GRHIAdapterName, *GRHIAdapterUserDriverVersion);
	ApplyUpscaler(Dlss, Tsr);
	const bool bDev = FParse::Param(FCommandLine::Get(), TEXT("JsgbDev"));
	bShowHud = bDev && FParse::Param(FCommandLine::Get(), TEXT("JsgbHud"));
	bShowKeys = bDev && FParse::Param(FCommandLine::Get(), TEXT("JsgbDlssKeys"));
	bShowJitter = bDev && FParse::Param(FCommandLine::Get(), TEXT("JsgbJitter"));
}

void AJsgbHost::ApplyHandheld()
{
	const TCHAR* Cmd = FCommandLine::Get();
	const bool bNvidia = GRHIVendorId == 0x10DE;
	bHandheld = FParse::Param(Cmd, TEXT("JsgbHandheld")) || (!bNvidia && !FParse::Param(Cmd, TEXT("JsgbNoHandheld")));
	if (!bHandheld) { return; }
	auto Set = [](const TCHAR* Name, const TCHAR* Value) { if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(Name)) { V->Set(Value, ECVF_SetByCode); } };
	// No Lumen, DLSS or frame generation.
	if (bLumenOn) { SetLumen(false); }
	bLumenAvailable = false;
	bFrameGen = false;
	Set(TEXT("r.NGX.DLSS.Enable"), TEXT("0"));
	Set(TEXT("r.Streamline.DLSSG.Enable"), TEXT("0"));
	Set(TEXT("r.DynamicGlobalIlluminationMethod"), TEXT("0"));
	Set(TEXT("r.ReflectionMethod"), TEXT("0"));
	// Low and medium scalability, TSR at 67% render scale.
	static const TCHAR* Low[] = {TEXT("sg.ShadowQuality"), TEXT("sg.GlobalIlluminationQuality"), TEXT("sg.ReflectionQuality"), TEXT("sg.EffectsQuality"), TEXT("sg.FoliageQuality")};
	static const TCHAR* Medium[] = {TEXT("sg.ViewDistanceQuality"), TEXT("sg.AntiAliasingQuality"), TEXT("sg.PostProcessQuality"), TEXT("sg.TextureQuality"), TEXT("sg.ShadingQuality")};
	for (const TCHAR* G : Low) { Set(G, TEXT("0")); }
	for (const TCHAR* G : Medium) { Set(G, TEXT("1")); }
	Set(TEXT("r.AntiAliasingMethod"), TEXT("4"));
	Set(TEXT("r.ScreenPercentage"), TEXT("67"));
	// At most 60 frames per second.
	Set(TEXT("t.MaxFPS"), TEXT("60"));
	Upscaler = TEXT("Handheld: TSR 67%, no Lumen, 60 FPS cap");
	UE_LOG(LogJsgbHost, Display, TEXT("Handheld preset on (GPU %s, vendor 0x%04x%s): no Lumen, DLSS or frame generation; TSR at 67%%; low shadows and effects; at most 60 FPS"),
		*GRHIAdapterName, GRHIVendorId, FParse::Param(Cmd, TEXT("JsgbHandheld")) ? TEXT(", -JsgbHandheld") : TEXT(""));
}

bool AJsgbHost::HandleDlssKey(const FKey& Key)
{
	// F9: Lumen mode on or off, in every game this host can light with Lumen.
	if (Key == EKeys::F9 && bLumenAvailable) { SetLumen(!bLumenOn); return true; }
	if (bShowKeys && Key == EKeys::F8) { bShowJitter = !bShowJitter; return true; }
	if (!bShowKeys || (Key != EKeys::F6 && Key != EKeys::F7)) { return false; }
	if (Key == EKeys::F6) { CycleUpscaler(); } else { ToggleFrameGen(); }
	return true;
}

void AJsgbHost::CycleUpscaler()
{
	static const TCHAR* Modes[] = {TEXT("off"), TEXT("dlaa"), TEXT("quality"), TEXT("balanced"), TEXT("performance"), TEXT("5")};
	int32 Next = 0;
	for (int32 I = 0; I < UE_ARRAY_COUNT(Modes); ++I) { if (DlssMode == Modes[I]) { Next = (I + 1) % UE_ARRAY_COUNT(Modes); } }
	ApplyUpscaler(Modes[Next], FString());
}

void AJsgbHost::ToggleFrameGen()
{
	// Off, 2x, then 3x and 4x where the GPU has Multi Frame Generation.
	if (!bFrameGen) { bFrameGen = true; FrameGenFrames = 1; }
	else if (FrameGenFrames < MaxGeneratedFrames()) { ++FrameGenFrames; }
	else { bFrameGen = false; FrameGenFrames = 1; }
	if (!bFrameGen) { SetCVar(TEXT("r.Streamline.DLSSG.Enable"), TEXT("0")); }
	ApplyUpscaler(DlssMode, FString());
}

// Switches anti-aliasing and upscaling while the game runs (also the script step "upscaler dlaa|quality|...|off|tsr <percent>").
void AJsgbHost::ApplyUpscaler(const FString& Mode, const FString& TsrPercent)
{
	FString Dlss = Mode.ToLower(), Tsr = TsrPercent;
	DlssMode = Dlss.IsEmpty() ? FString(TEXT("off")) : Dlss;
	Upscaler.Reset();
	NeuralNote.Reset();
	// DLSS 5: Neural Rendering where it can run; otherwise DLSS 4.5 DLAA, with the reason in the log and the readout.
	if (Dlss == TEXT("5") || Dlss == TEXT("dlss5"))
	{
		FString Why, Short;
		if (!NeuralRenderingCheck(Why, Short))
		{
			UE_LOG(LogJsgbHost, Display, TEXT("DLSS 5 Neural Rendering is off: %s. Using DLSS 4.5 DLAA."), *Why);
			NeuralNote = Short;
			Dlss = TEXT("dlaa");
		}
	}
	const bool bNvidia = IsRHIDeviceNVIDIA();
	const bool bDlssPlugin = IConsoleManager::Get().FindConsoleVariable(TEXT("r.NGX.DLSS.Enable")) != nullptr;
	double Percent = 100;
	if (!Dlss.IsEmpty() && Dlss != TEXT("off"))
	{
		static const TMap<FString, double> Modes = {{TEXT("dlaa"), 100.0}, {TEXT("quality"), 66.7}, {TEXT("balanced"), 58.0}, {TEXT("performance"), 50.0}, {TEXT("ultra"), 33.3}};
		const double* Found = Modes.Find(Dlss);
		Percent = Found ? *Found : 66.7;
		if (bNvidia && bDlssPlugin)
		{
			SetCVar(TEXT("r.AntiAliasingMethod"), TEXT("4"));
			SetCVar(TEXT("r.NGX.DLSS.Enable"), TEXT("1"));
			SetCVar(TEXT("r.ScreenPercentage"), FString::SanitizeFloat(Percent));
			// DLSS 4.5's second-generation transformer model (preset M) in every mode; -JsgbDLSSPreset=<letter> picks another.
			FString Preset = TEXT("M");
			FParse::Value(FCommandLine::Get(), TEXT("JsgbDLSSPreset="), Preset);
			Preset = Preset.Left(1).ToUpper();
			SetCVar(TEXT("r.NGX.DLSS.Preset"), FString::FromInt(Preset[0] - TEXT('A') + 1));
			Upscaler = FString::Printf(TEXT("DLSS 4.5 %s, preset %s (%.0f%% render scale)"), Dlss == TEXT("dlaa") ? TEXT("DLAA") : *Dlss, *Preset, Percent);
		}
		else
		{
			Tsr = FString::SanitizeFloat(Percent);
			UE_LOG(LogJsgbHost, Warning, TEXT("DLSS needs an NVIDIA RTX GPU and the NVIDIA DLSS plugin (GPU NVIDIA: %d, plugin: %d); using TSR at %.0f%%"), bNvidia, bDlssPlugin, Percent);
		}
	}
	if (Upscaler.IsEmpty() && !Tsr.IsEmpty())
	{
		Percent = FCString::Atod(*Tsr);
		SetCVar(TEXT("r.AntiAliasingMethod"), TEXT("4"));
		SetCVar(TEXT("r.ScreenPercentage"), FString::SanitizeFloat(Percent));
		if (bDlssPlugin) { SetCVar(TEXT("r.NGX.DLSS.Enable"), TEXT("0")); }
		Upscaler = FString::Printf(TEXT("TSR (%.0f%% render scale)"), Percent);
	}
	if (Upscaler.IsEmpty())
	{
		// Back to the default: FXAA at full resolution.
		SetCVar(TEXT("r.AntiAliasingMethod"), TEXT("1"));
		SetCVar(TEXT("r.ScreenPercentage"), TEXT("100"));
		if (bDlssPlugin) { SetCVar(TEXT("r.NGX.DLSS.Enable"), TEXT("0")); }
	}
	if (bFrameGen)
	{
		SetCVar(TEXT("r.Streamline.DLSSG.FramesToGenerate"), FString::FromInt(FrameGenFrames));
		SetCVar(TEXT("r.Streamline.DLSSG.Enable"), TEXT("1"));
		const FString Label = FrameGenFrames > 1 ? FString::Printf(TEXT("Multi Frame Generation %dx"), FrameGenFrames + 1) : FString(TEXT("Frame Generation 2x"));
		Upscaler += Upscaler.IsEmpty() ? Label : TEXT(" + ") + Label;
	}
	FString Vibrance;
	if (FParse::Value(FCommandLine::Get(), TEXT("JsgbVibrance="), Vibrance))
	{
		SetCVar(TEXT("r.Streamline.DeepDVC.Enable"), TEXT("1"));
		SetCVar(TEXT("r.Streamline.DeepDVC.Intensity"), Vibrance);
		Upscaler += Upscaler.IsEmpty() ? TEXT("RTX Dynamic Vibrance") : TEXT(" + RTX Dynamic Vibrance");
	}
	if (Upscaler.IsEmpty()) { Upscaler = TEXT("DLSS off (FXAA, full resolution)"); }
	UE_LOG(LogJsgbHost, Display, TEXT("Anti-aliasing and upscaling: %s"), *Upscaler);
	HudSeconds = 0.5;
}

// Frames on screen per second with DLSS Frame Generation, from the NVIDIA plugin's Blueprint library.
// It is found by name, so the bridge builds and runs without the plugin. Returns -1 when unavailable.
static float PresentedFps()
{
	static UFunction* Timing = nullptr;
	static UObject* Library = nullptr;
	if (!Timing)
	{
		UClass* Class = FindObject<UClass>(nullptr, TEXT("/Script/StreamlineDLSSGBlueprint.StreamlineLibraryDLSSG"));
		if (!Class) { return -1.f; }
		Library = Class->GetDefaultObject();
		Timing = Class->FindFunctionByName(TEXT("GetDLSSGFrameTiming"));
		if (!Timing) { return -1.f; }
	}
	TArray<uint8> Params;
	Params.SetNumZeroed(Timing->ParmsSize);
	Library->ProcessEvent(Timing, Params.GetData());
	const FFloatProperty* Rate = CastField<FFloatProperty>(Timing->FindPropertyByName(TEXT("FrameRateInHertz")));
	return Rate ? Rate->GetPropertyValue_InContainer(Params.GetData()) : -1.f;
}

// The last 90 frame times as bars, 1 pixel per ms up to 50: green under 16.7 ms, yellow under 33.4, red above.
TSharedRef<SWidget> AJsgbHost::MakeJitterGraph()
{
	TSharedRef<SHorizontalBox> Bars = SNew(SHorizontalBox);
	for (int32 I = 0; I < 90; ++I)
	{
		const int32 Back = 90 - I;
		auto Ms = [this, Back]() { return JitterMs.Num() ? JitterMs[(JitterHead - Back + JitterMs.Num()) % JitterMs.Num()] : 0.f; };
		Bars->AddSlot().AutoWidth().VAlign(VAlign_Bottom).Padding(FMargin(0, 0, 1, 0))
		[
			SNew(SBox).WidthOverride(3.f).HeightOverride(TAttribute<FOptionalSize>::CreateLambda([Ms]() { return FOptionalSize(FMath::Clamp(Ms(), 1.f, 50.f)); }))
			[
				SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
				.BorderBackgroundColor(TAttribute<FSlateColor>::CreateLambda([Ms]() { const float M = Ms(); return FSlateColor(M < 16.7f ? FLinearColor(0.3f, 0.9f, 0.4f) : M < 33.4f ? FLinearColor(1.f, 0.8f, 0.2f) : FLinearColor(1.f, 0.3f, 0.25f)); }))
			]
		];
	}
	return SNew(SBox).HeightOverride(50.f).VAlign(VAlign_Bottom).Visibility(TAttribute<EVisibility>::CreateLambda([this]() { return bShowJitter ? EVisibility::HitTestInvisible : EVisibility::Collapsed; }))
		[
			Bars
		];
}

void AJsgbHost::UpdateHud(float DeltaSeconds)
{
	HudFrames++;
	HudSeconds += DeltaSeconds;
	if (JitterMs.Num() != 600) { JitterMs.Init(0.f, 600); JitterHead = 0; }
	JitterMs[JitterHead] = DeltaSeconds * 1000.f;
	JitterHead = (JitterHead + 1) % JitterMs.Num();
	if (HudSeconds < 0.5) { return; }
	{
		// Over the last second: the spread of frame times (standard deviation) and the worst frame; over the last 600
		// frames: the 1% low. The game's update rate is how often the JavaScript thread sends a scene.
		const int32 N = JitterMs.Num();
		const float Second = 1000.f;
		double Sum = 0, Sum2 = 0, Worst = 0, Spent = 0; int32 Count = 0;
		for (int32 I = 1; I <= N && Spent < Second; ++I)
		{
			const float Ms = JitterMs[(JitterHead - I + N) % N];
			if (Ms <= 0) { break; }
			Sum += Ms; Sum2 += Ms * Ms; Worst = FMath::Max<double>(Worst, Ms); Spent += Ms; ++Count;
		}
		TArray<float> Sorted = JitterMs.FilterByPredicate([](float Ms) { return Ms > 0; });
		Sorted.Sort([](float A, float B) { return A > B; });
		double Low = 0; const int32 Slowest = FMath::Max(1, Sorted.Num() / 100);
		for (int32 I = 0; I < Slowest && I < Sorted.Num(); ++I) { Low += Sorted[I]; }
		const double Mean = Count ? Sum / Count : 0, Spread = Count ? FMath::Sqrt(FMath::Max(0.0, Sum2 / Count - Mean * Mean)) : 0;
		const FString Game = JsThread ? FString::Printf(TEXT("game %.0f Hz / draw %.0f FPS"), 1.0 / SnapshotInterval, HudFps)
			: !PageIndex.IsEmpty() ? FString::Printf(TEXT("page up to 60 Hz / draw %.0f FPS"), HudFps) : FString::Printf(TEXT("game and draw %.0f FPS"), HudFps);
		JitterLine = FString::Printf(TEXT("Jitter %.1f ms   1%% low %.0f FPS   worst %.0f ms\n%s   F8 hides"), Spread, Sorted.Num() ? 1000.0 * Slowest / Low : 0.0, Worst, *Game);
	}
	HudFps = HudFrames / HudSeconds;
	HudFrames = 0; HudSeconds = 0;
	HudPresentedFps = Upscaler.Contains(TEXT("Frame Generation")) ? PresentedFps() : -1.f;
	if (!bShowHud || !GEngine || !GEngine->GameViewport) { return; }
	if (!HudText.IsValid())
	{
		TSharedRef<SWidget> Box = SNew(SBox).HAlign(HAlign_Right).VAlign(VAlign_Top).Padding(FMargin(0, 64, 16, 0)).Visibility(EVisibility::HitTestInvisible)
			[
				SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(0.f, 0.f, 0.f, 0.72f)).Padding(FMargin(14, 8))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SAssignNew(HudText, STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Bold", 22)).ColorAndOpacity(FLinearColor(0.49f, 1.f, 0.66f))
					]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right).Padding(FMargin(0, 6, 0, 0))
					[
						MakeJitterGraph()
					]
				]
			];
		GEngine->GameViewport->AddViewportWidgetContent(Box, 300);
	}
	// While a capture runs, each frame waits for its screenshot, so the frame rate means nothing: show the mode only.
	if (!CaptureDir.IsEmpty()) { HudText->SetText(FText::FromString(Upscaler)); return; }
	const FString Rate = HudPresentedFps > 0 ? FString::Printf(TEXT("%.0f FPS on screen, %.0f rendered"), HudPresentedFps, HudFps) : FString::Printf(TEXT("%.0f FPS"), HudFps);
	HudText->SetText(FText::FromString(FString::Printf(TEXT("%s%s\n%s  (GPU %.1f ms)%s%s%s"), *Upscaler, bLumenOn ? TEXT(", Lumen") : TEXT(""), *Rate, FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles()),
		bShowJitter ? *(TEXT("\n") + JitterLine) : TEXT(""),
		NeuralNote.IsEmpty() ? TEXT("") : *(TEXT("\n") + NeuralNote), bShowKeys ? TEXT("\nF6: DLSS mode   F7: Frame Generation   F8: jitter   F9: Lumen") : TEXT(""))));
}

void AJsgbHost::SwapCss(double BuildMs)
{
	PageCss.Reset();
	if (const TSharedPtr<FJsonObject> Page = LoadJson(GameDir / TEXT("page.json"))) { FFileHelper::LoadFileToString(PageCss, *(GameDir / Page->GetStringField(TEXT("css")))); }
	++CssVersion;
	CssStart = FPlatformTime::Seconds();
	CssBuildMs = BuildMs;
	if (!Browser.IsValid()) { return; }
	auto Packet = MakeShared<FJsonObject>();
	Packet->SetStringField(TEXT("css"), PageCss);
	Browser->ExecuteJavascript(TEXT("window.JsGameUI&&window.JsGameUI.css((") + JsonString(Packet) + FString::Printf(TEXT(").css, %d)"), CssVersion));
}

void AJsgbHost::StartRecording(const FString& Dir, double Fps)
{
	StopRecording();
	IFileManager::Get().MakeDirectory(*Dir, true);
	RecordDir = Dir;
	RecordFps = FMath::Clamp(Fps, 1.0, 60.0);
	RecordIndex = 0;
	RecordTimes.Reset();
	NextRecord = FPlatformTime::Seconds();
	RecordEncoding = MakeShared<FThreadSafeCounter>();
	FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
	// The frame grabber copies the finished window (game and overlay) to a ring of GPU buffers and reads each one
	// a few frames later. A screenshot instead waits for the GPU to finish every recorded frame.
	const UGameEngine* Game = Cast<UGameEngine>(GEngine);
	if (Game && Game->SceneViewport.IsValid() && !FParse::Param(FCommandLine::Get(), TEXT("JsgbRecordScreenshots")))
	{
		Grabber = MakeShared<FFrameGrabber>(Game->SceneViewport.ToSharedRef(), Game->SceneViewport->GetSize(), PF_B8G8R8A8, 4);
		Grabber->StartCapturingFrames();
		return;
	}
	// With a listener bound, the engine hands over the window pixels instead of writing a PNG.
	RecordHandle = UGameViewportClient::OnScreenshotCaptured().AddUObject(this, &AJsgbHost::OnRecordedFrame);
}

namespace
{
	/** When a grabbed frame was rendered. */
	struct FRecordedAt : IFramePayload { int64 UnixMs = 0; };
	int64 UnixMsNow() { return (FDateTime::UtcNow() - FDateTime(1970, 1, 1)).GetTicks() / ETimespan::TicksPerMillisecond; }
}

void AJsgbHost::TakeGrabbedFrames()
{
	if (!Grabber) { return; }
	for (FCapturedFrameData& F : Grabber->GetCapturedFrames())
	{
		const FRecordedAt* At = static_cast<const FRecordedAt*>(F.Payload.Get());
		SaveRecordedFrame(MoveTemp(F.ColorBuffer), F.BufferSize.X, F.BufferSize.Y, At ? At->UnixMs : UnixMsNow());
	}
}

void AJsgbHost::OnRecordedFrame(int32 Width, int32 Height, const TArray<FColor>& Bitmap)
{
	if (RecordDir.IsEmpty()) { return; }
	SaveRecordedFrame(TArray<FColor>(Bitmap), Width, Height, UnixMsNow());
}

void AJsgbHost::SaveRecordedFrame(TArray<FColor>&& Bitmap, int32 Width, int32 Height, int64 UnixMs)
{
	const FString Name = FString::Printf(TEXT("frame_%05d.jpg"), RecordIndex++);
	RecordTimes += FString::Printf(TEXT("%s %lld\n"), *Name, UnixMs);
	TSharedPtr<FThreadSafeCounter> Pending = RecordEncoding;
	Pending->Increment();
	Async(EAsyncExecution::ThreadPool, [Pixels = MoveTemp(Bitmap), Width, Height, Path = RecordDir / Name, Pending]()
	{
		IImageWrapperModule& Images = FModuleManager::GetModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
		TSharedPtr<IImageWrapper> Jpeg = Images.CreateImageWrapper(EImageFormat::JPEG);
		if (Jpeg.IsValid() && Jpeg->SetRaw(Pixels.GetData(), Pixels.Num() * sizeof(FColor), Width, Height, ERGBFormat::BGRA, 8))
		{
			const TArray64<uint8>& Data = Jpeg->GetCompressed(92);
			FFileHelper::SaveArrayToFile(Data, *Path);
		}
		Pending->Decrement();
	});
}

void AJsgbHost::StopRecording()
{
	if (RecordDir.IsEmpty()) { return; }
	UGameViewportClient::OnScreenshotCaptured().Remove(RecordHandle);
	if (Grabber)
	{
		// The last frames are still on the GPU: wait for them, then take them.
		Grabber->StopCapturingFrames();
		for (int32 I = 0; I < 8 && Grabber->HasOutstandingFrames(); ++I) { FlushRenderingCommands(); TakeGrabbedFrames(); }
		TakeGrabbedFrames();
		Grabber->Shutdown();
		Grabber.Reset();
	}
	const double Until = FPlatformTime::Seconds() + 10;
	while (RecordEncoding.IsValid() && RecordEncoding->GetValue() > 0 && FPlatformTime::Seconds() < Until) { FPlatformProcess::Sleep(0.005f); }
	FFileHelper::SaveStringToFile(RecordTimes, *(RecordDir / TEXT("times.txt")));
	UE_LOG(LogJsgbHost, Display, TEXT("Recorded %d frames to %s"), RecordIndex, *RecordDir);
	RecordDir.Reset();
}

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
	for (int32 I = 0; I < ScriptAnswers.Num(); ++I)
	{
		if (!ScriptAnswers[I].Value->bDone) { break; }
		Bridge->Log(TEXT("log"), FString::Printf(TEXT("%s -> %s"), *ScriptAnswers[I].Key, *ScriptAnswers[I].Value->Text.Left(800)));
		ScriptAnswers.RemoveAt(I--);
	}
	if (!WaitFor.IsEmpty())
	{
		// "wait <text or selector>" holds the script until that element exists, "gone" until it no
		// longer does (a loading screen closing), "objects <n>" until the scene draws at least n objects (a world
		// finished loading). Later steps keep their spacing.
		const double Now = GameSeconds();
		bool bFound = WaitUIVersion >= 0;
		if (WaitObjects >= 0)
		{
			bFound = Mirror && Mirror->DrawnEntities >= WaitObjects;
			if (bFound) { WaitSeen = Now; }
		}
		else if (!bFound)
		{
			// Asked without waiting, so a busy JavaScript thread never holds up Unreal's frame.
			// The answer carries the game time the JavaScript thread saw the element (or saw it go).
			if (!WaitQuery.IsValid()) { WaitQuery = Ask(FString::Printf(TEXT("__jsgb.find(%s)!==%s?__jsgbHost.now():-1"), *ScriptArg(WaitFor), bWaitGone ? TEXT("true") : TEXT("false"))); }
			if (!WaitQuery->bDone && Now - WaitStart < 120.0) { return; }
			const double SeenMs = WaitQuery->bDone ? FCString::Atod(*WaitQuery->Text) : -1.0;
			bFound = WaitQuery->bDone && WaitQuery->Text.IsNumeric() && SeenMs >= 0;
			if (bFound) { WaitSeen = FMath::Clamp(SeenMs / 1000.0, WaitStart, Now); }
			WaitQuery.Reset();
		}
		// The game's DOM changed; the wait ends when the overlay shows that change on screen.
		if (bFound && WaitObjects < 0 && WaitUIVersion < 0 && UIPort && Browser.IsValid()) { Ask(TEXT("__jsgb.publish&&__jsgb.publish()")); WaitUIVersion = Bridge->UIVersion; }
		const bool bShown = !bFound || WaitUIVersion < 0 || !UIPort || UIPort->AppliedUIVersion >= WaitUIVersion;
		// A browser shows a DOM change in the frame that made it. With a fixed game clock the game waits
		// for the overlay too (no time passes and no game frame runs), so the game's time and the script's
		// stay together.
		bHoldClock = bFound && !bShown && Bridge->FixedStepMs > 0;
		if ((!bFound || !bShown) && Now - WaitStart < 120.0) { return; }
		bHoldClock = false;
		WaitUIVersion = -1;
		Bridge->Log(bFound ? TEXT("log") : TEXT("error"), FString::Printf(TEXT("script %s %s: %s after %.1fs"), WaitObjects >= 0 ? TEXT("objects") : bWaitGone ? TEXT("gone") : TEXT("wait"), *WaitFor, bFound ? TEXT("done") : TEXT("timed out"), Now - WaitStart));
		WaitObjects = -1;
		// The wait ends when the game reached that state, as in a browser. The time Unreal took to learn
		// of it (the question's round trip, the overlay update) belongs to the next step, so the game's own
		// clock and the script's stay together.
		const double End = bFound && WaitSeen >= 0 ? WaitSeen : Now;
		WaitSeen = -1;
		ReadySeconds += End - WaitStart;
		WaitFor.Reset();
		if (!CaptureDir.IsEmpty()) { CaptureTimes += FString::Printf(TEXT("wait-end %.3f\n"), End - CaptureStart); }
	}
	const double Rel = GameSeconds() - ReadySeconds;
	while (ScriptCursor < Script.Num() && (Script[ScriptCursor].bAbsolute ? Script[ScriptCursor].Frame <= Frame : Script[ScriptCursor].Time <= Rel))
	{
		const FJsgbScriptStep& S = Script[ScriptCursor++];
		FString Result;
		if (S.Verb == TEXT("objects")) { WaitFor = S.Args; WaitObjects = FCString::Atoi(*S.Args); WaitStart = GameSeconds(); Bridge->Log(TEXT("log"), FString::Printf(TEXT("script objects %s: waiting"), *S.Args)); return; }
		if (S.Verb == TEXT("wait") || S.Verb == TEXT("gone")) { WaitFor = S.Args; bWaitGone = S.Verb == TEXT("gone"); WaitStart = GameSeconds(); Bridge->Log(TEXT("log"), FString::Printf(TEXT("script %s %s: waiting"), *S.Verb, *S.Args)); return; }
		const FString Code = S.Verb == TEXT("eval") ? S.Args : S.Verb == TEXT("click") ? FString::Printf(TEXT("__jsgb.click(%s)"), *ScriptArg(S.Args))
			: S.Verb == TEXT("seed") ? FString::Printf(TEXT("__jsgb.seed(%s)"), *S.Args) : S.Verb == TEXT("key") ? FString::Printf(TEXT("__jsgb.key(%s)"), *S.Args) : FString();
		if (!Code.IsEmpty())
		{
			// The JavaScript thread answers on its next turn; the step is logged when the answer arrives.
			ScriptAnswers.Emplace(FString::Printf(TEXT("script %.2fs %s %s"), Rel, *S.Verb, *S.Args.Left(160)), Ask(Code));
			continue;
		}
		else if (S.Verb == TEXT("shot")) { Capture(CaptureDir.IsEmpty() ? FPaths::ProjectSavedDir() / TEXT("JsGameBridge") / (S.Args + TEXT(".png")) : CaptureDir / (S.Args + TEXT(".png"))); }
		else if (S.Verb == TEXT("quit")) { ExitFrame = Frame + 2; }
		// "console <command>": an Unreal console command (Unreal only; the browser runner skips it).
		else if (S.Verb == TEXT("console") && GEngine) { GEngine->Exec(GetWorld(), *S.Args); }
		else if (S.Verb == TEXT("upscaler")) { FString Mode = S.Args.TrimStartAndEnd(), Pct; if (Mode.StartsWith(TEXT("tsr"))) { Pct = Mode.Mid(3).TrimStart(); Mode.Reset(); } ApplyUpscaler(Mode, Pct); Result = Upscaler; if (!CaptureDir.IsEmpty() && CaptureStart >= 0) { CaptureTimes += FString::Printf(TEXT("upscaler %.3f %s\n"), GameSeconds() - CaptureStart, *Upscaler); } }
		Bridge->Log(TEXT("log"), FString::Printf(TEXT("script %.2fs %s %s -> %s"), Rel, *S.Verb, *S.Args.Left(160), *Result.Left(800)));
	}
}

void AJsgbHost::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	++Frame;
	GJsgbWindowFocus.store(FSlateApplication::IsInitialized() && FSlateApplication::Get().IsActive(), std::memory_order_relaxed);
	// A mirrored scene can present at its simulation cadence, independently of page-game caps.
	// Apply after the game's display preferences too; otherwise a saved unlimited cap wins at startup.
	static const float SceneFps = [] { float Fps = 0; FParse::Value(FCommandLine::Get(), TEXT("JsgbSceneFps="), Fps); return FMath::Clamp(Fps, 0.f, 240.f); }();
	if (SceneFps > 0 && !IsPageGame())
	{
		// The external frame-generation pacer claims the cap even with generation off. Use the engine's clock.
		static IConsoleVariable* Pacer = IConsoleManager::Get().FindConsoleVariable(TEXT("t.Streamline.Reflex.HandleMaxTickRate"));
		if (Pacer && Pacer->GetInt() != 0) { Pacer->Set(0, ECVF_SetByCode); }
		static IConsoleVariable* MaxFps = IConsoleManager::Get().FindConsoleVariable(TEXT("t.MaxFPS"));
		if (MaxFps && MaxFps->GetFloat() != SceneFps) { MaxFps->Set(SceneFps, ECVF_SetByCode); }
	}
	UpdateHud(DeltaSeconds);
	// A page game loading files: Unreal ticks up to PageLoadFps until a second after the last request, then returns to the
	// page's cap. Loading a city layer took 30% longer than in Chrome at 60 ticks a second.
	if (PagePort)
	{
		const float Want = FPlatformTime::Seconds() - LastPageFile < 1.0 ? FMath::Max(PageLoadFps, PagePort->Cap) : PagePort->Cap;
		IConsoleVariable* MaxFps = IConsoleManager::Get().FindConsoleVariable(TEXT("t.MaxFPS"));
		if (MaxFps && MaxFps->GetFloat() != Want) { MaxFps->Set(Want, ECVF_SetByCode); }
	}
	if (FrameTimesMs.Num() < 1000000) { FrameTimesMs.Add(DeltaSeconds * 1000.f); }
	if (RecordDir.IsEmpty() && CaptureQueue.Num() && !FScreenshotRequest::IsScreenshotRequested()) { FScreenshotRequest::RequestScreenshot(CaptureQueue[0], true, false); CaptureQueue.RemoveAt(0); }
	if (Grabber)
	{
		TakeGrabbedFrames();
		if (FPlatformTime::Seconds() >= NextRecord)
		{
			NextRecord = FMath::Max(NextRecord + 1.0 / RecordFps, FPlatformTime::Seconds() - 0.5 / RecordFps);
			TSharedRef<FRecordedAt, ESPMode::ThreadSafe> At = MakeShared<FRecordedAt, ESPMode::ThreadSafe>();
			At->UnixMs = UnixMsNow();
			Grabber->CaptureThisFrame(At);
		}
	}
	else if (!RecordDir.IsEmpty() && !FScreenshotRequest::IsScreenshotRequested() && FPlatformTime::Seconds() >= NextRecord)
	{
		NextRecord = FMath::Max(NextRecord + 1.0 / RecordFps, FPlatformTime::Seconds() - 0.5 / RecordFps);
		FScreenshotRequest::RequestScreenshot(RecordDir / TEXT("unused.png"), true, false);
	}
	if (CssStart >= 0 && UIPort && UIPort->AppliedCssVersion >= CssVersion)
	{
		LastCssMs = (FPlatformTime::Seconds() - CssStart) * 1000.0;
		CssStart = -1;
		const FString Line = CssBuildMs >= 0
			? FString::Printf(TEXT("Hot reload (CSS): build %.2f s + Unreal %.2f s = %.2f s"), CssBuildMs / 1000.0, LastCssMs / 1000.0, (CssBuildMs + LastCssMs) / 1000.0)
			: FString::Printf(TEXT("Hot reload (CSS): Unreal %.2f s"), LastCssMs / 1000.0);
		if (Bridge) { Bridge->Log(TEXT("log"), Line); }
		ShowReloadBanner(Line);
	}
	if (bRestart || (Bridge && Bridge->bReloadRequested))
	{
		bRestart = false;
		if (ReloadStart < 0) { ReloadStart = FPlatformTime::Seconds(); ReloadBuildMs = -1; }
		StopJs();
		if (!PendingBundle.IsEmpty()) { LoadPublication(GameDir, PendingBundle); PendingBundle.Reset(); }
		StartJs();
	}
	UpdateLoading();
	// A page game takes the keyboard whenever the window is active, so keys work without a click first.
	if (!PageIndex.IsEmpty() && Browser.IsValid() && FSlateApplication::Get().IsActive() && !Browser->HasAnyUserFocusOrFocusedDescendants())
	{
		FSlateApplication::Get().SetAllUserFocus(Browser.ToSharedRef(), EFocusCause::SetDirectly);
	}
	// A page game has no JavaScript in Unreal; only the time limit applies.
	if (!PageIndex.IsEmpty() && MaxSeconds > 0 && FPlatformTime::Seconds() - HostStartSeconds > MaxSeconds) { FPlatformMisc::RequestExit(false); }
	// The game's delegates belong to the JavaScript thread while it runs, so the game thread doesn't read them.
	if (!Bridge || (!JsThread && !Bridge->OnFrame.IsBound())) { return; }
	Audio->StartPending();
	// With a fixed clock each game frame is one step, as in the browser; a held clock runs no game frame.
	const bool bHeld = Bridge->FixedStepMs > 0 && bHoldClock;
	if (Bridge->FixedStepMs > 0 && !bHeld) { Bridge->VirtualMs += Bridge->FixedStepMs; }

	FIntPoint Size(1920, 1080);
	if (UGameViewportClient* Vp = GetWorld()->GetGameViewport()) { FVector2D S; Vp->GetViewportSize(S); if (S.X > 0) { Size = FIntPoint(S.X, S.Y); } }
	if (Size != Viewport) { Viewport = Size; Mirror->ViewportSize = Size; UJsgbBridge* B = Bridge; B->RunOnJs([B, Size] { if (B->OnViewport.IsBound()) { B->OnViewport.Execute(Size.X, Size.Y); } }); }

	if (ReadyFrame < 0 && Bridge->bReady) { ReadyFrame = Frame; ReadySeconds = GameSeconds(); CaptureStart = ReadySeconds; Bridge->Log(TEXT("log"), FString::Printf(TEXT("game ready at host frame %lld"), Frame)); }
	RunScript();
	// Unreal's own times for the last finished frame: game thread, render thread, RHI thread and GPU.
	const double Engine[4] = {FPlatformTime::ToMilliseconds(GGameThreadTime), FPlatformTime::ToMilliseconds(GRenderThreadTime),
		FPlatformTime::ToMilliseconds(GRHIThreadTime), FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles())};
	for (int32 I = 0; I < 4; ++I) { EngineMs[I] += Engine[I]; }
	++EngineFrames;
	// A frame much longer than 60 FPS allows gets a breakdown of the tick before it, and the engine's times.
	// -JsgbSlowFrameMs=<ms> lowers the threshold, to see what the frames just over 16.7 ms are made of.
	static const float SlowFrameMs = [] { float Ms = 34.f; FParse::Value(FCommandLine::Get(), TEXT("JsgbSlowFrameMs="), Ms); return Ms; }();
	if (ReadyFrame >= 0 && DeltaSeconds * 1000.f > SlowFrameMs && LastTick.Num() == 11)
	{
		Bridge->Log(TEXT("log"), FString::Printf(TEXT("slow frame %lld: %.0f ms; previous tick: js %.1f ms (mirror %.1f: materials %.1f in %d, textures %.1f, meshes %.1f, instanced %.1f, build queue %.1f in %d builds, stall %.1f), ui %.1f ms; engine: game thread %.1f, render thread %.1f, RHI thread %.1f, GPU %.1f ms"),
			Frame, DeltaSeconds * 1000.f, LastTick[0], LastTick[1], LastTick[6], static_cast<int32>(LastTick[7]), LastTick[8], LastTick[9], LastTick[10], LastTick[2], static_cast<int32>(LastTick[3]), LastTick[4], LastTick[5],
			Engine[0], Engine[1], Engine[2], Engine[3]));
	}
	const double MirrorBefore = Bridge->MirrorMs, QueueBefore = Mirror->QueueMs, StallBefore = Mirror->StallMs;
	const double MaterialBefore = Bridge->MaterialMs, TextureBefore = Bridge->TextureMs, MeshBefore = Mirror->RecordMs[1], InstancedBefore = Mirror->RecordMs[2];
	const int32 MaterialCallsBefore = Bridge->MaterialCalls;
	const int32 BuildsBefore = Mirror->QueueBuilds;
	const double T0 = FPlatformTime::Seconds();
	if (JsThread)
	{
		// Snapshots arrive at the game's rate; between them objects and the camera glide (one snapshot behind).
		// An update reaches this thread up to one Unreal frame after the JavaScript thread made it, so arrival times jitter.
		// The glide to each update ends a fixed time after it was made (one game interval plus one Unreal frame), so the
		// objects move at the game's own pace; it starts from where they are drawn now, so nothing jumps.
		const double Now = FPlatformTime::Seconds();
		DrawInterval = FMath::Clamp(0.9 * DrawInterval + 0.1 * DeltaSeconds, 0.002, 0.1);
		if (Bridge->DrainGameCommands() > 0)
		{
			const double Produced = Bridge->LastFrameProducedAt > 0 ? Bridge->LastFrameProducedAt : Now;
			if (LastProduced > 0) { SnapshotInterval = FMath::Clamp(0.9 * SnapshotInterval + 0.1 * (Produced - LastProduced), 0.004, 0.1); }
			LastProduced = Produced;
			LastSnapshot = Now;
			SegmentStart = Now;
			SegmentEnd = FMath::Max(Produced + SnapshotInterval + DrawInterval, Now + 0.001);
			// -JsgbArrivalInterpolation: the earlier timing, from each update's arrival over one game interval (for comparison).
			static const bool bArrival = FParse::Param(FCommandLine::Get(), TEXT("JsgbArrivalInterpolation"));
			if (bArrival) { SegmentEnd = Now + SnapshotInterval; }
		}
		Mirror->Interpolate(LastSnapshot > 0 ? static_cast<float>((Now - SegmentStart) / (SegmentEnd - SegmentStart)) : 1.f);
		const FVector CameraAt = Camera->GetComponentLocation();
		const double Speed = DeltaSeconds > 0 ? FVector::Dist(CameraAt, LastCameraAt) / DeltaSeconds : 0;
		if (Speed > 10.0 && Speed < 100000.0) { CamSpeedSum += Speed; CamSpeedSum2 += Speed * Speed; ++CamSpeedFrames; }
		LastCameraAt = CameraAt;
	}
	else if (!bHeld) { Bridge->OnFrame.Execute(ReadyFrame < 0 ? 40.f : 8.f); }
	const double T1 = FPlatformTime::Seconds();
	JsMs += (T1 - T0) * 1000.0; ++TimedFrames;
	PushUI();
	LastTick = {(T1 - T0) * 1000.0, Bridge->MirrorMs - MirrorBefore, Mirror->QueueMs - QueueBefore, static_cast<double>(Mirror->QueueBuilds - BuildsBefore), Mirror->StallMs - StallBefore, (FPlatformTime::Seconds() - T1) * 1000.0,
		Bridge->MaterialMs - MaterialBefore, static_cast<double>(Bridge->MaterialCalls - MaterialCallsBefore), Bridge->TextureMs - TextureBefore, Mirror->RecordMs[1] - MeshBefore, Mirror->RecordMs[2] - InstancedBefore};
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
		// Where a frame's time goes: the game's own JavaScript, the mirror, and the GPU.
		const int32 N = FMath::Max(1, TimedFrames);
		Bridge->Log(TEXT("log"), FString::Printf(TEXT("host frame %lld: js+mirror %.2f ms (game js %.2f, mirror %.2f, of which lines %.2f, materials %.2f in %d updates, textures %.2f in %d updates; build queue %.2f in %d builds, meshes %.2f, instanced %.2f, sprites %.2f, points %.2f, line records %.2f), frame %.2f ms, fps %.1f, gpu %.2f ms, drawn %d, lines %d, pending builds %d, voices %d, js errors %d"),
			Frame, JsMs / N, (JsMs - Bridge->MirrorMs) / N, Bridge->MirrorMs / N, Mirror->LinesMs / N, Bridge->MaterialMs / N, Bridge->MaterialCalls, Bridge->TextureMs / N, Bridge->TextureCalls, Mirror->QueueMs / N, Mirror->QueueBuilds, Mirror->RecordMs[1] / N, Mirror->RecordMs[2] / N, Mirror->RecordMs[4] / N, Mirror->RecordMs[5] / N, Mirror->RecordMs[6] / N, DeltaSeconds * 1000.f, HudFps, FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles()),
			Mirror->DrawnEntities, Mirror->LineSegmentsDrawn, Mirror->PendingBuilds(), Audio->ActiveVoices(), Bridge->ErrorCount));
		const double E = FMath::Max(1, EngineFrames);
		Bridge->Log(TEXT("log"), FString::Printf(TEXT("engine average over %d frames: game thread %.2f ms, render thread %.2f ms, RHI thread %.2f ms, GPU %.2f ms"),
			EngineFrames, EngineMs[0] / E, EngineMs[1] / E, EngineMs[2] / E, EngineMs[3] / E));
		for (double& M : EngineMs) { M = 0; }
		EngineFrames = 0;
		if (CamSpeedFrames > 30)
		{
			// Spread of the camera's speed from frame to frame, as a share of its average: low means smooth motion.
			const double Mean = CamSpeedSum / CamSpeedFrames, Spread = FMath::Sqrt(FMath::Max(0.0, CamSpeedSum2 / CamSpeedFrames - Mean * Mean));
			Bridge->Log(TEXT("log"), FString::Printf(TEXT("camera motion over %d moving frames: speed %.0f cm/s average, frame-to-frame spread %.1f%%"), CamSpeedFrames, Mean, 100.0 * Spread / Mean));
		}
		CamSpeedSum = 0; CamSpeedSum2 = 0; CamSpeedFrames = 0;
		if (JsThread)
		{
			double Avg = 0, Max = 0; int32 JsFrames = 0;
			JsThread->TakeStats(Avg, Max, JsFrames);
			Bridge->Log(TEXT("log"), FString::Printf(TEXT("JavaScript thread: %d game frames, %.2f ms average, %.1f ms longest"), JsFrames, Avg, Max));
		}
		JsMs = 0; TimedFrames = 0; Bridge->MirrorMs = 0; Mirror->ClearTimers(); Bridge->MaterialMs = 0; Bridge->TextureMs = 0; Bridge->MaterialCalls = 0; Bridge->TextureCalls = 0;
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
