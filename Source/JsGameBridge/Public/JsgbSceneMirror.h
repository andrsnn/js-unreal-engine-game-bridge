#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Components/LineBatchComponent.h"
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
class UJsgbBridge;

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
	FString LineSignature;
	/** A line object's segments in world space, drawn through the mirror's one shared line component. */
	TArray<FBatchedLine> Lines;
	FVector LineCenter = FVector::ZeroVector;
	float Model[16] = {0};
};

USTRUCT()
struct FJsgbLight
{
	GENERATED_BODY()
	UPROPERTY() TObjectPtr<ULightComponent> Component;
	int32 Kind = 0;
	uint32 Seen = 0;
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
	void SetMaterial(int32 Id, const FString& Json);
	void SetTexture(int32 Id, const FString& Json, const FArrayBuffer& Bytes);
	void ApplyFrame(const float* Data, int32 Count, const float* Inst, int32 InstCount);
	void ApplyEvents(const FString& Json);
	void SetShader(const FString& Key, const FString& Json);
	FString Describe(int32 Kind) const;
	int32 DebugHiddenKinds = 0;
	bool SetAssetRegistry(const FString& Json);
	void ResetAll();

	UPROPERTY() TObjectPtr<UCameraComponent> Camera;
	/** All three.js lines draw through this one component, in three.js's transparent order, so
	 *  overlapping lines never swap order between frames (separate components did, and broke rings into segments). */
	UPROPERTY() TObjectPtr<ULineBatchComponent> SharedLines;
	FString SharedLinesOrder;
	/** Line segments the shared line component draws this frame. */
	int32 LineSegmentsDrawn = 0;
	/** Sprites and points objects (camera-facing billboards) drawn this frame. */
	int32 SpritesDrawn = 0;
	int32 PointsDrawn = 0;
	UPROPERTY() TObjectPtr<UJsgbBridge> Bridge;
	float BuildBudgetMs = 6.f;
	float LightScale = 1.f;
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
	/** Builds a geometry the game draws for the first time, in this frame, as WebGL uploads it. */
	UStaticMesh* FirstBuild(int32 GeometryId, struct FJsgbGeometry* G);
	UStaticMesh* SpriteQuad();
	UMaterialInterface* ParentFor(int32 Variant);
	UMaterialInstanceDynamic* MaterialFor(int32 Id);
	void ApplyTextureParams(UMaterialInstanceDynamic* Mid, int32 TextureId);
	UStaticMeshComponent* NewComponent(bool bInstanced);
	FJsgbEntity& EntityOf(int32 Id, int32 Kind);
	void ApplyLight(const float* S, uint32 Stamp, FLinearColor& Ambient, FLinearColor& HemiSky, FLinearColor& HemiGround);
	void ApplyPost(const float* Header);
	void SetScene(FName Name, const FLinearColor& Value);
	void ApplySceneParams(UMaterialInstanceDynamic* Mid, int32 Variant);
	TSharedPtr<class FJsonObject> Asset(int32 KeyId) const;
	UMaterialInterface* GeneratedParent(const FString& Key, int32 Blend, bool bTwoSided);
	void SetModelData(FJsgbEntity& Ent, UPrimitiveComponent* C, const float* M, const float* Mats, int32 NumMats);
	void CheckGenerated();

	UPROPERTY() TMap<int32, FJsgbGeometry> Geometries;
	UPROPERTY() TMap<int32, FJsgbMaterial> Materials;
	UPROPERTY() TMap<int32, FJsgbTexture> Textures;
	UPROPERTY() TMap<int32, FJsgbEntity> Entities;
	UPROPERTY() TMap<int32, FJsgbLight> Lights;
	UPROPERTY() TArray<TObjectPtr<UMaterialInterface>> Parents;
	UPROPERTY() TObjectPtr<UMaterialInterface> Fallback;
	UPROPERTY() TObjectPtr<UMaterialParameterCollection> Globals;
	UPROPERTY() TObjectPtr<UStaticMesh> Quad;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> PostMid;
	TMap<FName, FLinearColor> SceneParams;
	UPROPERTY() TMap<FString, TObjectPtr<UObject>> LoadedAssets;
	TMap<FString, TSharedPtr<class FJsonObject>> Registry;
	TMap<FString, TSharedPtr<class FJsonObject>> Shaders;
	UPROPERTY() TMap<FString, TObjectPtr<UMaterial>> Generated;
	TArray<FString> GeneratedPending;
	TMap<int32, FString> KeyNames;
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
