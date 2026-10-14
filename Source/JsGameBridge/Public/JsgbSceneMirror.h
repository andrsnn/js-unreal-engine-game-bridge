#pragma once

#include "CoreMinimal.h"
#include "Engine/StreamableManager.h"
#include "Components/ActorComponent.h"
#include "Components/LineBatchComponent.h"
#include "Engine/TextureDefines.h"
#include "ArrayBuffer.h"
#include "JsgbSceneMirror.generated.h"

class UStaticMesh;
class UStaticMeshComponent;
class UInstancedStaticMeshComponent;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UMaterialParameterCollection;
class UTexture2D;
class ULightComponent;
class ULineBatchComponent;
class UNiagaraComponent;
class UCameraComponent;
class USceneCaptureComponent2D;
class UTextureRenderTarget2D;
class UJsgbBridge;

/** A mesh's render buffers, built from the game's arrays on any thread; FinishMesh makes the Unreal mesh. */
struct FJsgbPreparedMesh
{
	TUniquePtr<class FStaticMeshRenderData> RenderData;
	int32 Slots = 1, Vertices = 0, Triangles = 0, UVChannels = 1;
	double Ms = 0;
	bool bOffGameThread = false;
};

/** A texture's pixels, decoded and laid out on any thread; AcceptTexture makes the Unreal texture. */
struct FJsgbPreparedTexture
{
	TSharedPtr<class FJsonObject> Json;
	TUniquePtr<struct FTexturePlatformData> PlatformData;
	bool bVolume = false;
	double Ms = 0;
};

/** Geometry waiting to become a UStaticMesh (Three.js space, unconverted). */
struct FJsgbPendingGeometry
{
	TArray<float> Positions, Normals, UVs, Colors;
	TArray<uint32> Indices;
	int32 ColorSize = 0;
	TArray<FIntVector> Groups; // start, count, material index
	int32 DrawStart = 0, DrawCount = -1;
	/** 0 triangles, 1 points, 2 line segments, 3 line strip, 4 line loop. */
	int32 Primitive = 0;
	/** UV channels per vertex: 0 is the mesh UV, 1-7 carry the shader's own attributes. */
	int32 UVChannels = 1;
	/** Built ahead of time on the JavaScript thread, when it runs on its own thread. */
	TSharedPtr<FJsgbPreparedMesh> Prepared;
};

USTRUCT()
struct FJsgbGeometry
{
	GENERATED_BODY()
	UPROPERTY() TObjectPtr<UStaticMesh> Mesh;
	int32 Slots = 1;
	int32 Revision = 0;
	int32 BuiltRevision = -1;
	int32 Primitive = 0;
	TSharedPtr<FJsgbPendingGeometry> Pending;
	/** Lines keep their points (Three.js space) for the line batcher. */
	TArray<FVector3f> LinePoints;
	TArray<FLinearColor> LineColors;
};

USTRUCT()
struct FJsgbMaterial
{
	GENERATED_BODY()
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> Instance;
	int32 Variant = -1;
	int32 Map = 0;
	FString Json;
	FLinearColor Color = FLinearColor::White;
	float Opacity = 1.f;
	float Size = 1.f;
	bool bSizeAttenuation = true;
	bool bVertexColors = false;
	float Rotation = 0.f;
	/** Drawn with a material generated from the game's own shader (needs the model matrix). */
	bool bCustom = false;
	/** three.js fog: false. Such surfaces write custom stencil 1 and the scene post skips their fog. */
	bool bNoFog = false;
	/** three.js side: 0 front, 1 back, 2 double. Back-side surfaces draw with reversed culling. */
	int32 Side = 0;
	/** A fat line's width (Line2): in pixels, or in world units; 0 for an ordinary one-pixel line. */
	float FatWidth = 0.f;
	bool bFatWorld = false;
	/** three.js draws it opaque without writing depth (a sky dome drawn first): Unreal draws it translucent, first. */
	bool bDrawFirst = false;
	/** Its generated material moves vertices in the vertex shader (world position offset: camera-facing sprites). */
	bool bMovesVertices = false;
	/** Textures bound through uniforms (shader materials and hooks): parameter name and texture id. */
	TArray<TPair<FName, int32>> UniformTextures;
};

USTRUCT()
struct FJsgbTexture
{
	GENERATED_BODY()
	UPROPERTY() TObjectPtr<UTexture> Texture;
	bool bFlipY = true;
	FVector4f UVTransform = FVector4f(1, 1, 0, 0);
};

USTRUCT()
struct FJsgbEntity
{
	GENERATED_BODY()
	UPROPERTY() TObjectPtr<UPrimitiveComponent> Component;
	UPROPERTY() TObjectPtr<UNiagaraComponent> Effect;
	int32 Id = 0;
	int32 Kind = 0;
	int32 Geometry = 0;
	int32 GeometryRevision = -1;
	TArray<int32, TInlineAllocator<2>> Materials;
	uint32 Seen = 0;
	int32 InstanceCount = 0;
	/** The instances moved last frame, so their previous transforms still differ from the current ones. */
	bool bInstancesMoved = false;
	/** The instance data (matrices, then colours) the component holds, as the game sent it; an update with the same
	 *  bytes is skipped. */
	TArray<float> InstanceRaw;
	/** The transforms the component draws, all slots: the first InstanceCount are the game's, the rest are hidden spare
	 *  slots kept so a shrinking count doesn't rebuild the render state. */
	TArray<FTransform> InstanceDrawn;
	/** Hash of what a line object's segments depend on (geometry, material, transform); 0 before the first draw. */
	uint32 LineSignature = 0;
	/** A line object's segments in world space, drawn through the mirror's one shared line component. */
	TArray<FBatchedLine> Lines;
	FVector LineCenter = FVector::ZeroVector;
	/** The line's width: pixels on screen, or world units when bLineWorld. */
	float LineWidth = 1.f;
	bool bLineWorld = false;
	float Model[16] = {0};
	/** Interpolation (JavaScript on its own thread): drawn from From toward To between two snapshots. */
	FTransform From, To;
	bool bPlaced = false;
	/** Where the game put the object last frame, and whether it had moved then (teleports start from rest). */
	FVector LastTarget = FVector::ZeroVector;
	bool bWasMoving = false;
	/** The render target texture whose scene this object belongs to; 0 for the game's view. */
	int32 Capture = 0;
};

/** A scene the game draws into a render target (a minimap, a screen in the world): a scene capture draws only
 *  that scene's objects into a render target texture, which materials use like any other texture. */
USTRUCT()
struct FJsgbCapture
{
	GENERATED_BODY()
	UPROPERTY() TObjectPtr<USceneCaptureComponent2D> Component;
	UPROPERTY() TObjectPtr<UTextureRenderTarget2D> Target;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> Post;
	/** The objects drawn into it this frame. */
	TArray<TWeakObjectPtr<UPrimitiveComponent>> Members;
	uint32 Seen = 0;
};

USTRUCT()
struct FJsgbLight
{
	GENERATED_BODY()
	UPROPERTY() TObjectPtr<ULightComponent> Component;
	int32 Kind = 0;
	uint32 Seen = 0;
	int32 Capture = 0;
};

USTRUCT()
struct FJsgbOverrideMaterials
{
	GENERATED_BODY()
	UPROPERTY() TArray<TObjectPtr<UMaterialInstanceDynamic>> Slots;
	UPROPERTY() TObjectPtr<UStaticMesh> Mesh;
};

/** Draws the web game's Three.js scene with Unreal components. Geometry becomes runtime static
 *  meshes shared by every object that uses it; instanced meshes become ISMs; points and sprites
 *  become camera-facing quads; lines go to a line batcher; lights, ambient, fog, background and
 *  bloom follow the scene each frame. Objects tagged with a registry key draw the registry's
 *  Unreal mesh or Niagara system instead. No game rules live here. */
UCLASS()
class JSGAMEBRIDGE_API UJsgbSceneMirror : public UActorComponent
{
	GENERATED_BODY()
public:
	UJsgbSceneMirror();

	void SetGeometry(int32 Id, const FArrayBuffer& Positions, const FArrayBuffer& Normals, const FArrayBuffer& UVs, const FArrayBuffer& Colors, int32 ColorSize, const FArrayBuffer& Indices, const FString& Groups);
	void ReleaseGeometry(int32 Id);
	void ReleaseMaterial(int32 Id);
	void ReleaseTexture(int32 Id);
	void SetMaterial(int32 Id, const FString& Json);
	void SetTexture(int32 Id, const FString& Json, const FArrayBuffer& Bytes);
	/** Decodes and lays out a texture's pixels; safe on any thread. FileData holds the bytes of a "file" texture. */
	static TSharedPtr<FJsgbPreparedTexture> PrepareTexture(const FString& Json, const FArrayBuffer& Bytes, const TArray<uint8>& FileData);
	void AcceptTexture(int32 Id, TSharedPtr<FJsgbPreparedTexture> P);
	void ApplyFrame(const float* Data, int32 Count, const float* Inst, int32 InstCount);
	void ApplyEvents(const FString& Json);
	void SetShader(const FString& Key, const FString& Json);
	FString Describe(int32 Kind) const;
	int32 DebugHiddenKinds = 0;
	/** Debugging (/bridge/describe "hideids:<first>-<last>"): hide the objects with ids in this range. */
	FIntPoint DebugHiddenIds = FIntPoint(1, 0);
	bool SetAssetRegistry(const FString& Json);
	FStreamableManager Streamable;
	TSharedPtr<struct FStreamableHandle> RegistryLoad;
	/** Loads the override models in the background (Lumen mode on) and calls Done once they are in memory, or
	 *  releases them (off). */
	void LoadOverrides(bool bLoad, TFunction<void()> Done = nullptr);
	TSharedPtr<struct FStreamableHandle> OverrideLoad;
	void ResetAll();

	UPROPERTY() TObjectPtr<UCameraComponent> Camera;
	/** All three.js lines draw through this one component, in three.js's transparent order, so
	 *  overlapping lines never swap order between frames (separate components did, and broke rings into segments). */
	UPROPERTY() TObjectPtr<ULineBatchComponent> SharedLines;
	FString SharedLinesOrder;
	/** Line segments the shared line component draws this frame. */
	int32 LineSegmentsDrawn = 0;
	/** Time spent ordering and rebuilding the shared lines, summed until the host reads and clears it. */
	double LinesMs = 0;
	/** With the game's JavaScript on its own thread, objects and the camera glide between snapshots:
	 *  each snapshot sets where they go, and Interpolate moves them there over the time between snapshots. */
	bool bInterpolate = false;
	void Interpolate(float Alpha);
	TArray<int32> Moving;
	FTransform CameraFrom, CameraTo;
	bool bCameraPlaced = false;
	void Place(FJsgbEntity& Ent, USceneComponent* C, const FTransform& T, int32 Flags);
	/** Time per record type (index = record type) and in the build queue, and builds done, until the host reads and clears them. */
	double RecordMs[16] = {};
	double QueueMs = 0;
	int32 QueueBuilds = 0;
	void ClearTimers() { LinesMs = 0; QueueMs = 0; QueueBuilds = 0; for (double& T : RecordMs) { T = 0; } }
	/** Sprites and points objects (camera-facing billboards) drawn this frame. */
	int32 SpritesDrawn = 0;
	int32 PointsDrawn = 0;
	UPROPERTY() TObjectPtr<UJsgbBridge> Bridge;
	float BuildBudgetMs = 6.f;
	/** With the JavaScript thread, new objects past this many milliseconds of one update wait for the next snapshot. */
	float CreateBudgetMs = 8.f;
	/** New objects left for the next snapshot this frame. */
	int32 DeferredEntities = 0;
	float LightScale = 1.f;
	/** How much of the scene's ambient and hemisphere light the override materials add (1 as in three.js;
	 *  lower with Lumen, which lights them from the sky instead). */
	float OverrideAmbientScale = 1.f;
	/** Lumen mode (-JsgbLumen): directional lights get this source angle in degrees (soft shadows), shadows and
	 *  volumetric scattering; ambient and hemisphere light in the bridge's materials is scaled by LumenAmbientScale. */
	bool bLumen = false;
	float SunSourceAngle = 1.f;
	/** Lumen mode: extra exposure in stops, bloom and directional light multipliers on top of the game's own. */
	float ExposureOffset = 0.f, BloomScale = 1.f, SunScale = 1.f;
	float LumenAmbientScale = 1.f;
	/** The average light of an environment map (three.js envMap, scene.environment) a material reflects; times the
	 *  material's envMapIntensity it becomes its EnvLight. -JsgbEnvRadiance= overrides it. */
	float EnvRadiance = 5.f;
	int32 FrameCounter = 0;

	FVector CameraLocation = FVector::ZeroVector;
	FRotator CameraRotation = FRotator::ZeroRotator;
	float CameraHFov = 90.f;
	int32 DrawnEntities = 0;
	/** -JsgbTraceMirror: log every object that stops being drawn while the game still draws it, and why. */
	bool bTrace = false;
	/** Objects the game drew this frame that the mirror could not draw (no built mesh). */
	int32 SkippedEntities = 0;
	/** Drawn objects whose generated material is still compiling (Unreal shows its default material). */
	int32 CompilingEntities = 0;
	/** Milliseconds spent building first-use meshes and compiling generated materials. The game
	 *  clock leaves this time out, so the game sees uploads as instant, as in a browser frame. */
	double StallMs = 0;
	int32 EmptyBuilds = 0;
	int32 PendingBuilds() const { return BuildQueue.Num(); }
	FIntPoint ViewportSize = FIntPoint(1920, 1080);

private:
	UStaticMesh* BuildMesh(const FJsgbPendingGeometry& G, int32& OutSlots);
	UStaticMesh* BuildMeshFromDescription(const FJsgbPendingGeometry& G, int32& OutSlots);
	UStaticMesh* FinishMesh(FJsgbPreparedMesh& P, int32& OutSlots);
public:
	static TSharedPtr<FJsgbPreparedMesh> PrepareMesh(const FJsgbPendingGeometry& G);
	static bool UseMeshDescription();
	static TSharedPtr<FJsgbPendingGeometry> ParseGeometry(const FArrayBuffer& Positions, const FArrayBuffer& Normals, const FArrayBuffer& UVs, const FArrayBuffer& Colors, int32 ColorSize, const FArrayBuffer& Indices, const FString& Groups);
	void AcceptGeometry(int32 Id, TSharedPtr<FJsgbPendingGeometry> G);
private:
	/** Builds a geometry the game draws for the first time, in this frame, as WebGL uploads it. */
	UStaticMesh* FirstBuild(int32 GeometryId, struct FJsgbGeometry* G);
	UStaticMesh* SpriteQuad();
	UMaterialInterface* ParentFor(int32 Variant);
	UMaterialInterface* OneSidedParent(int32 Variant);
	/** An asset by path: from memory when it's there, otherwise loaded now. A load waits for every background
	 *  load in flight, so the bridge's own assets load once at start and game assets load in the background. */
	template <typename T> T* Resolve(const FString& Path)
	{
		if (Path.IsEmpty()) { return nullptr; }
		TObjectPtr<UObject>& Cached = LoadedAssets.FindOrAdd(Path);
		if (!Cached) { Cached = FSoftObjectPath(Path).ResolveObject(); }
		if (!Cached) { Cached = LoadObject<T>(nullptr, *Path, nullptr, LOAD_NoWarn | LOAD_Quiet); }
		return Cast<T>(Cached);
	}
	UMaterialInstanceDynamic* MaterialFor(int32 Id);
	void ApplyTextureParams(UMaterialInstanceDynamic* Mid, int32 TextureId);
	class UTexture2D* SameShapeTexture(UTexture* Old, const struct FTexturePlatformData& New, bool bSRGB, TextureFilter Filter, TextureAddress X, TextureAddress Y);
	UStaticMeshComponent* NewComponent(bool bInstanced);
	FJsgbEntity& EntityOf(int32 Id, int32 Kind);
	void ApplyLight(const float* S, uint32 Stamp, FLinearColor& Ambient, FLinearColor& HemiSky, FLinearColor& HemiGround, int32 Capture = 0);
	FJsgbCapture& CaptureFor(int32 TextureId, int32 Width, int32 Height);
	void ApplyCapture(FJsgbCapture& Cap, const float* R);
	void ApplyPost(const float* Header);
	void SetScene(FName Name, const FLinearColor& Value);
	void ApplySceneParams(UMaterialInstanceDynamic* Mid, int32 Variant);
	/** Whether a material instance's parent has this vector parameter. Setting one it lacks still costs a render command. */
	bool HasVectorParam(UMaterialInstanceDynamic* Mid, FName Name);
	TMap<TObjectKey<UMaterialInterface>, TSet<FName>> ParentVectorParams;
	TSharedPtr<class FJsonObject> Asset(int32 KeyId) const;
	UMaterialInterface* GeneratedParent(const FString& Key, int32 Blend, bool bTwoSided);
	void SetModelData(FJsgbEntity& Ent, UPrimitiveComponent* C, const float* M, const float* Mats, int32 NumMats);
	void CheckGenerated();

	UPROPERTY() TMap<int32, FJsgbGeometry> Geometries;
	UPROPERTY() TMap<int32, FJsgbMaterial> Materials;
	UPROPERTY() TMap<int32, FJsgbTexture> Textures;
	UPROPERTY() TMap<int32, FJsgbEntity> Entities;
	UPROPERTY() TMap<int32, FJsgbLight> Lights;
	UPROPERTY() TMap<int32, FJsgbCapture> Captures;
	/** While a frame is applied: the render target whose scene the records belong to (0 for the game's view). */
	int32 CurrentCapture = 0;
	UPROPERTY() TArray<TObjectPtr<UMaterialInterface>> Parents;
	/** One-sided copies of the two-sided parents (transparent, masked and unlit), for FrontSide and BackSide materials. */
	UPROPERTY() TArray<TObjectPtr<UMaterialInterface>> OneSidedParents;
	UPROPERTY() TObjectPtr<UMaterialInterface> Fallback;
	UPROPERTY() TObjectPtr<UTexture> DefaultTexture2D;
	UPROPERTY() TObjectPtr<UTexture> DefaultCube;
	UPROPERTY() TObjectPtr<UTexture> DefaultVolume;
	UPROPERTY() TObjectPtr<UMaterialParameterCollection> Globals;
	UPROPERTY() TObjectPtr<UStaticMesh> Quad;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> PostMid;
	TMap<FName, FLinearColor> SceneParams;
	UPROPERTY() TMap<FString, TObjectPtr<UObject>> LoadedAssets;
	TMap<FString, TSharedPtr<class FJsonObject>> Registry;
	TMap<FString, TSharedPtr<class FJsonObject>> Shaders;
	/** scene.background as a texture: the sky sphere, its material and the frame it was last sent. */
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Sky;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> SkyMid;
	uint32 SkySeen = 0;
	void ApplyBackground(const float* R);
	/** Generated materials a packaged host found no cooked asset for (they draw plainly). */
	int32 MissingGenerated = 0;
	UPROPERTY() TMap<FString, TObjectPtr<UMaterial>> Generated;
	TArray<FString> GeneratedPending;
	TMap<int32, FString> KeyNames;
	/** Asset overrides: one material instance per override and slot, shared by every object it draws. */
	UPROPERTY() TMap<FString, FJsgbOverrideMaterials> OverrideMaterials;
	void UseOverrideMaterials(UStaticMeshComponent* C, int32 KeyId);
	TArray<int32> BuildQueue;
	uint32 Stamp = 0;
	// Trace state per object id: 1 drawn, 2 skipped, 3 drawn with a compiling material.
	TMap<int32, uint8> TraceState;
	TMap<int32, int32> TraceSince;
	/** This frame's line objects: squared distance from the camera, and object id. */
	TArray<TPair<double, int32>> FrameLines;
	void TraceRecord(int32 Id, uint8 State, const TCHAR* Why);
	bool MaterialCompiling(int32 MaterialId) const;
};
