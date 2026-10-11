#include "JsgbHost.h"
#include "JsgbSceneMirror.h"
#include "Camera/CameraComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "HAL/IConsoleManager.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

DEFINE_LOG_CATEGORY_STATIC(LogJsgbFidelity, Log, All);

namespace
{
	void Set(const TCHAR* Name, const TCHAR* Value)
	{
		if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(Name)) { V->Set(Value, ECVF_SetByCode); }
		else { UE_LOG(LogJsgbFidelity, Warning, TEXT("Console variable %s is missing"), Name); }
	}
}

// -JsgbLumen[=high|light] lights the game with Unreal's own lighting instead of matching the browser:
//   Lumen global illumination and reflections, a sky light that captures the game's own sky (stars, nebulae),
//   the game's directional lights as suns with soft virtual shadow maps, volumetric fog that scatters the sun
//   and the engines' light, and less of three.js's flat ambient light (Lumen's bounce light replaces it).
// "light" is the cheaper preset: half-resolution Lumen gathers and reflections, coarser shadows and fog.
// Bloom and exposure still follow the game's own settings, so the comparison with Lumen off is fair.
void AJsgbHost::SetupLumen()
{
	FString Preset;
	const bool bValue = FParse::Value(FCommandLine::Get(), TEXT("JsgbLumen="), Preset);
	if (!bValue && !FParse::Param(FCommandLine::Get(), TEXT("JsgbLumen"))) { return; }
	LumenPreset = Preset.IsEmpty() ? TEXT("high") : Preset.ToLower();
	const bool bLight = LumenPreset == TEXT("light");

	Set(TEXT("r.DynamicGlobalIlluminationMethod"), TEXT("1"));
	Set(TEXT("r.ReflectionMethod"), TEXT("1"));
	Set(TEXT("r.Shadow.Virtual.Enable"), TEXT("1"));
	Set(TEXT("r.Lumen.DiffuseIndirect.Allow"), TEXT("1"));
	Set(TEXT("r.Lumen.Reflections.Allow"), TEXT("1"));
	// The bridge's runtime meshes have no distance fields; screen traces find them, and the imported Nanite
	// models (with distance fields) carry the bounce light between ships.
	Set(TEXT("r.Lumen.TraceMeshSDFs"), TEXT("1"));
	Set(TEXT("r.Lumen.ScreenProbeGather.ScreenTraces"), TEXT("1"));
	Set(TEXT("r.Lumen.ScreenProbeGather.DownsampleFactor"), bLight ? TEXT("32") : TEXT("16"));
	Set(TEXT("r.Lumen.Reflections.DownsampleFactor"), bLight ? TEXT("2") : TEXT("1"));
	Set(TEXT("r.Lumen.Reflections.MaxRoughnessToTrace"), bLight ? TEXT("0.3") : TEXT("0.45"));
	Set(TEXT("r.Shadow.Virtual.ResolutionLodBiasDirectional"), bLight ? TEXT("0.5") : TEXT("-0.5"));
	Set(TEXT("r.Shadow.Virtual.SMRT.RayCountDirectional"), bLight ? TEXT("4") : TEXT("8"));
	Set(TEXT("r.VolumetricFog"), TEXT("1"));
	Set(TEXT("r.VolumetricFog.GridPixelSize"), bLight ? TEXT("16") : TEXT("8"));
	Set(TEXT("r.VolumetricFog.GridSizeZ"), bLight ? TEXT("64") : TEXT("128"));
	Set(TEXT("r.SkyLight.RealTimeReflectionCapture"), TEXT("1"));

	FPostProcessSettings& P = Camera->PostProcessSettings;
	P.bOverride_DynamicGlobalIlluminationMethod = true; P.DynamicGlobalIlluminationMethod = EDynamicGlobalIlluminationMethod::Lumen;
	P.bOverride_ReflectionMethod = true; P.ReflectionMethod = EReflectionMethod::Lumen;
	P.bOverride_LumenSceneLightingQuality = true; P.LumenSceneLightingQuality = bLight ? 0.5f : 1.f;
	P.bOverride_LumenFinalGatherQuality = true; P.LumenFinalGatherQuality = bLight ? 0.5f : 1.f;
	P.bOverride_LumenReflectionQuality = true; P.LumenReflectionQuality = bLight ? 0.5f : 1.f;
	P.bOverride_LumenSceneViewDistance = true; P.LumenSceneViewDistance = 2000000.f;
	P.bOverride_LumenMaxTraceDistance = true; P.LumenMaxTraceDistance = 200000.f;

	// The sky light captures whatever the game draws far away (stars, nebulae, planets) every frame, so the
	// fill light on the ships takes the colour of the game's own sky.
	LumenSky = NewObject<USkyLightComponent>(this);
	LumenSky->SourceType = ESkyLightSourceType::SLS_CapturedScene;
	LumenSky->bRealTimeCapture = true;
	LumenSky->SetIntensity(bLight ? 2.f : 2.5f);
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

	Mirror->bLumen = true;
	Mirror->SunSourceAngle = bLight ? 0.6f : 1.2f;
	// Lumen's bounce light and the sky light replace most of three.js's flat ambient.
	Mirror->LumenAmbientScale = 0.35f;
	Mirror->OverrideAmbientScale = 0.25f;
	UE_LOG(LogJsgbFidelity, Display, TEXT("Lumen lighting on (preset %s): global illumination and reflections, sky light capture, soft sun shadows, volumetric fog"), *LumenPreset);
}
