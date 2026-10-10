#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
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
	int32 Kind = 0;
	int32 Geometry = 0;
	int32 GeometryRevision = -1;
	TArray<int32, TInlineAllocator<2>> Materials;
	uint32 Seen = 0;
	int32 InstanceCount = 0;
	FString LineSignature;
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
	UPROPERTY() TObjectPtr<UJsgbBridge> Bridge;
	float BuildBudgetMs = 6.f;
	float LightScale = 1.f;
	int32 FrameCounter = 0;

	FVector CameraLocation = FVector::ZeroVector;
	FRotator CameraRotation = FRotator::ZeroRotator;
	float CameraHFov = 90.f;
	int32 DrawnEntities = 0;
	int32 EmptyBuilds = 0;
	int32 PendingBuilds() const { return BuildQueue.Num(); }
	FIntPoint ViewportSize = FIntPoint(1920, 1080);

private:
	UStaticMesh* BuildMesh(const FJsgbPendingGeometry& G, int32& OutSlots);
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
};
