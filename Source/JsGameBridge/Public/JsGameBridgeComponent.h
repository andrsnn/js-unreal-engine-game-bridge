#pragma once
#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "JsGameBridgeComponent.generated.h"
class USceneComponent;
class UProceduralMeshComponent;
class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class FJsonObject;
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FJsBridgeAction,const FString&,JSON);
// Transport-independent renderer. Frame/actions can arrive through Puerts or CEF.
UCLASS(ClassGroup=(Rendering),meta=(BlueprintSpawnableComponent))
class JSGAMEBRIDGE_API UJsGameBridgeComponent : public UActorComponent {
 GENERATED_BODY()
public:
 UJsGameBridgeComponent();
 UFUNCTION(BlueprintCallable) bool SetAssetRegistry(const FString& JSON);
 UFUNCTION(BlueprintCallable) bool ApplyScene(const FString& JSON);
 UFUNCTION(BlueprintCallable) void SendAction(const FString& Key,const FString& ParametersJSON);
 UFUNCTION(BlueprintCallable) void ResetScene();
 UPROPERTY(BlueprintAssignable) FJsBridgeAction OnAction;
 UPROPERTY(EditAnywhere,BlueprintReadWrite) float UnitsToCentimeters=100;
 virtual void EndPlay(const EEndPlayReason::Type Reason) override;
private:
 UPROPERTY() TMap<FString,TObjectPtr<USceneComponent>> Entities;
 UPROPERTY() TMap<FString,TObjectPtr<UProceduralMeshComponent>> Chunks;
 UPROPERTY() TMap<FString,TObjectPtr<UInstancedStaticMeshComponent>> Instances;
 UPROPERTY() TMap<FString,TObjectPtr<UMaterialInstanceDynamic>> Materials;
 TMap<FString,TSharedPtr<FJsonObject>> Assets;
 TMap<FString,int64> ChunkVersions;
 TMap<FString,FString> EntityGeometryBindings;
 TMap<FString,FString> EntityAssetBindings;
 int64 LastSequence=-1;
 USceneComponent* CreateEntity(const FString& Id,const TSharedPtr<FJsonObject>& Record);
 FTransform Transform(const TSharedPtr<FJsonObject>& Record) const;
 void UpdateMaterial(USceneComponent* Component,const TSharedPtr<FJsonObject>& Record);
 void ApplyEvent(const TSharedPtr<FJsonObject>& Event);
};
