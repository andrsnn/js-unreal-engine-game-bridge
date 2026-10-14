#include "JsgbHost.h"
#include "JsgbBridge.h"
#include "JsgbSceneMirror.h"
#include "Camera/CameraComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Dom/JsonObject.h"
#include "HAL/IConsoleManager.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "RenderUtils.h"

DEFINE_LOG_CATEGORY_STATIC(LogJsgbFidelity, Log, All);

namespace
{
	// The console variables Lumen mode sets, each with its value in the high and the light preset.
	struct FLumenVar { const TCHAR* Name; const TCHAR* High; const TCHAR* Light; };
	const FLumenVar LumenVars[] = {
		{TEXT("r.DynamicGlobalIlluminationMethod"), TEXT("1"), TEXT("1")},
		{TEXT("r.ReflectionMethod"), TEXT("1"), TEXT("1")},
		{TEXT("r.Shadow.Virtual.Enable"), TEXT("1"), TEXT("1")},
		{TEXT("r.Lumen.DiffuseIndirect.Allow"), TEXT("1"), TEXT("1")},
		{TEXT("r.Lumen.Reflections.Allow"), TEXT("1"), TEXT("1")},
		// The bridge's runtime meshes have no distance fields; screen traces find them, and the imported Nanite
		// models (with distance fields) carry the bounce light between ships.
		{TEXT("r.Lumen.TraceMeshSDFs"), TEXT("1"), TEXT("1")},
		{TEXT("r.Lumen.ScreenProbeGather.ScreenTraces"), TEXT("1"), TEXT("1")},
		{TEXT("r.Lumen.ScreenProbeGather.DownsampleFactor"), TEXT("16"), TEXT("32")},
		{TEXT("r.Lumen.Reflections.DownsampleFactor"), TEXT("1"), TEXT("2")},
		{TEXT("r.Lumen.Reflections.MaxRoughnessToTrace"), TEXT("0.45"), TEXT("0.3")},
		{TEXT("r.Shadow.Virtual.ResolutionLodBiasDirectional"), TEXT("-0.5"), TEXT("0.5")},
		{TEXT("r.Shadow.Virtual.SMRT.RayCountDirectional"), TEXT("8"), TEXT("4")},
		{TEXT("r.VolumetricFog"), TEXT("1"), TEXT("1")},
		{TEXT("r.VolumetricFog.GridPixelSize"), TEXT("8"), TEXT("16")},
		{TEXT("r.VolumetricFog.GridSizeZ"), TEXT("128"), TEXT("64")},
		{TEXT("r.SkyLight.RealTimeReflectionCapture"), TEXT("1"), TEXT("1")},
		// The override models' 4096 textures, fully loaded for whatever is on screen: streamed by distance, a close-up
		// of a hull soon after it appears shows low-resolution mips (blurry, beige hulls in stills and films).
		{TEXT("r.Streaming.FullyLoadUsedTextures"), TEXT("1"), TEXT("1")},
		{TEXT("r.Streaming.PoolSize"), TEXT("4000"), TEXT("3000")},
		// Lumen mode's detailed models: the tonemapper's sharpening brings out what Nanite draws at a pixel's size.
		{TEXT("r.Tonemapper.Sharpen"), TEXT("0.8"), TEXT("0.6")},
	};

	void Set(const TCHAR* Name, const FString& Value)
	{
		if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(Name)) { V->Set(*Value, ECVF_SetByCode); }
		else { UE_LOG(LogJsgbFidelity, Warning, TEXT("Console variable %s is missing"), Name); }
	}
}

// Lumen mode lights the game with Unreal's own lighting instead of matching the browser: Lumen global illumination
// and reflections, a sky light that captures the game's own sky (stars, nebulae), the game's directional lights as
// suns with soft virtual shadow maps, and volumetric fog that scatters the sun and the engines' light. It also draws
// the override models (overrides.json) and the Unreal effects that file turns on (Runtime/src/overrides.ts).
// Every game starts with it off. The player turns it on and off while playing: F9, or a game's options menu through
// window.jsgb.graphics. -JsgbLumen[=high|light] starts with it on; "light" is the cheaper preset: half-resolution
// Lumen gathers and reflections, coarser shadows and fog. -JsgbNoLumen takes it away.
// Bloom and exposure still follow the game's own settings, so the comparison with Lumen off is fair.
void AJsgbHost::SetupLumen()
{
	FString Preset;
	const bool bValue = FParse::Value(FCommandLine::Get(), TEXT("JsgbLumen="), Preset);
	const bool bStartOn = bValue || FParse::Param(FCommandLine::Get(), TEXT("JsgbLumen"));
	LumenPreset = Preset.IsEmpty() ? TEXT("high") : Preset.ToLower();
	bLumenAvailable = !FParse::Param(FCommandLine::Get(), TEXT("JsgbNoLumen"));
	// The values Lumen mode changes, as the project set them, for when it turns off again.
	LumenSaved.Reset();
	for (const FLumenVar& V : LumenVars)
	{
		if (IConsoleVariable* C = IConsoleManager::Get().FindConsoleVariable(V.Name)) { LumenSaved.Add(V.Name, C->GetString()); }
	}
	const FPostProcessSettings& P = Camera->PostProcessSettings;
	SavedGiOverride = P.bOverride_DynamicGlobalIlluminationMethod; SavedGi = P.DynamicGlobalIlluminationMethod;
	SavedReflectionOverride = P.bOverride_ReflectionMethod; SavedReflection = P.ReflectionMethod;
	bLumenOn = false;
	// Turned on once the game's registry (and its override models) is known: AJsgbHost::BeginPlay.
	bLumenAtStart = bStartOn && bLumenAvailable;
	PublishGraphics();
}

void AJsgbHost::SetLumen(bool bOn)
{
	if (!bLumenAvailable) { bOn = false; }
	if (bOn == bLumenOn && LumenSky) { PublishGraphics(); return; }
	bLumenOn = bOn;
	const bool bLight = LumenPreset == TEXT("light");
	for (const FLumenVar& V : LumenVars)
	{
		if (bOn) { Set(V.Name, bLight ? V.Light : V.High); }
		else if (const FString* Old = LumenSaved.Find(V.Name)) { Set(V.Name, *Old); }
	}

	FPostProcessSettings& P = Camera->PostProcessSettings;
	if (bOn)
	{
		P.bOverride_DynamicGlobalIlluminationMethod = true; P.DynamicGlobalIlluminationMethod = EDynamicGlobalIlluminationMethod::Lumen;
		P.bOverride_ReflectionMethod = true; P.ReflectionMethod = EReflectionMethod::Lumen;
	}
	else
	{
		P.bOverride_DynamicGlobalIlluminationMethod = SavedGiOverride; P.DynamicGlobalIlluminationMethod = SavedGi;
		P.bOverride_ReflectionMethod = SavedReflectionOverride; P.ReflectionMethod = SavedReflection;
	}
	P.bOverride_LumenSceneLightingQuality = bOn; P.LumenSceneLightingQuality = bLight ? 0.5f : 1.f;
	P.bOverride_LumenFinalGatherQuality = bOn; P.LumenFinalGatherQuality = bLight ? 0.5f : 1.f;
	P.bOverride_LumenReflectionQuality = bOn; P.LumenReflectionQuality = bLight ? 0.5f : 1.f;
	P.bOverride_LumenSceneViewDistance = bOn; P.LumenSceneViewDistance = 2000000.f;
	P.bOverride_LumenMaxTraceDistance = bOn; P.LumenMaxTraceDistance = 200000.f;

	if (bOn && !LumenSky)
	{
		// The sky light captures whatever the game draws far away (stars, nebulae, planets) every frame, so the faint
		// fill light on the ships takes the colour of the game's own sky. It stays low so shadow sides stay dark.
		LumenSky = NewObject<USkyLightComponent>(this);
		LumenSky->SourceType = ESkyLightSourceType::SLS_CapturedScene;
		LumenSky->bRealTimeCapture = true;
		LumenSky->SetIntensity(0.6f);
		LumenSky->bLowerHemisphereIsBlack = false;
		LumenSky->SetMobility(EComponentMobility::Movable);
		LumenSky->SetupAttachment(GetRootComponent());
		LumenSky->RegisterComponent();

		// Volumetric fog everywhere (almost no height falloff), thin enough to leave space dark: it shows the sun's
		// shafts past the hulls and the glow around drives and weapon light.
		LumenFog = NewObject<UExponentialHeightFogComponent>(this);
		LumenFog->SetFogDensity(0.00002f);
		LumenFog->SetFogHeightFalloff(0.000001f);
		LumenFog->SetFogInscatteringColor(FLinearColor::Black);
		LumenFog->SetDirectionalInscatteringColor(FLinearColor::Black);
		LumenFog->SetVolumetricFog(true);
		LumenFog->SetVolumetricFogScatteringDistribution(0.75f);
		LumenFog->SetVolumetricFogAlbedo(FColor(170, 190, 215));
		LumenFog->SetVolumetricFogExtinctionScale(1.f);
		LumenFog->SetVolumetricFogDistance(bLight ? 600000.f : 1200000.f);
		LumenFog->SetupAttachment(GetRootComponent());
		LumenFog->RegisterComponent();
	}
	if (LumenSky) { LumenSky->SetVisibility(bOn); }
	if (LumenFog) { LumenFog->SetVisibility(bOn); }

	// The override models load in the background; the game keeps drawing its own until they are in memory.
	++LumenGeneration;
	bModelsReady = false;
	if (bOn)
	{
		// Nanite needs Shader Model 6 (the project's D3D12TargetedShaderFormats). Without it Unreal draws each override
		// model's fallback mesh, about 2% of its triangles, and the detailed models look low poly.
		if (!UseNanite(GMaxRHIShaderPlatform)) { UE_LOG(LogJsgbFidelity, Warning, TEXT("Nanite is off on this renderer (Shader Model 6 needed): the override models draw their low-detail fallback meshes")); }
		TWeakObjectPtr<AJsgbHost> Self(this);
		const int32 Generation = LumenGeneration;
		Mirror->LoadOverrides(true, [Self, Generation]
		{
			if (!Self.IsValid() || Self->LumenGeneration != Generation || !Self->bLumenOn) { return; }
			Self->bModelsReady = true;
			Self->PublishGraphics();
		});
	}
	else { Mirror->LoadOverrides(false); }

	Mirror->bLumen = bOn;
	Mirror->SunSourceAngle = bLight ? 0.6f : 1.2f;
	// Lumen's bounce light and the sky light replace most of three.js's flat ambient.
	Mirror->LumenAmbientScale = bOn ? 0.35f : 1.f;
	Mirror->OverrideAmbientScale = bOn ? 0.08f : 1.f;
	// The game's dark-space look: a strong key light and deep shadow sides. The sun is a little stronger than the
	// game's, exposure stays the game's own, and drives and weapons get a little more bloom.
	Mirror->ExposureOffset = 0.f;
	Mirror->SunScale = bOn ? 1.6f : 1.f;
	Mirror->BloomScale = bOn ? 1.3f : 1.f;
	PublishGraphics();
	UE_LOG(LogJsgbFidelity, Display, TEXT("%s"), bOn
		? *FString::Printf(TEXT("Lumen mode on (preset %s): global illumination and reflections, sky light capture, soft sun shadows, volumetric fog, override models"), *LumenPreset)
		: TEXT("Lumen mode off: the game's own lighting and models"));
	if (Bridge) { Bridge->Log(TEXT("log"), bOn ? TEXT("Lumen mode on") : TEXT("Lumen mode off")); }
}

void AJsgbHost::PublishGraphics()
{
	if (!Bridge) { return; }
	Bridge->SetGraphicsInfo(FString::Printf(TEXT("{\"lumen\":%s,\"available\":%s,\"models\":%s}"), bLumenOn ? TEXT("true") : TEXT("false"),
		bLumenAvailable ? TEXT("true") : TEXT("false"), bModelsReady ? TEXT("true") : TEXT("false")));
	TWeakObjectPtr<AJsgbHost> Self(this);
	Bridge->OnGraphicsSet = [Self](const TSharedPtr<FJsonObject>& In)
	{
		bool bOn = false;
		if (Self.IsValid() && In && In->TryGetBoolField(TEXT("lumen"), bOn)) { Self->SetLumen(bOn); }
	};
}
