#include "JsGameBridgeComponent.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Camera/CameraComponent.h"
#include "Camera/CameraShakeBase.h"
#include "Camera/PlayerCameraManager.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Actor.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "NiagaraComponent.h"
#include "ProceduralMeshComponent.h"
#include "Sound/SoundBase.h"
#include "Engine/StaticMesh.h"
#include "Materials/Material.h"
#include "Engine/World.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
namespace {
using JObject=TSharedPtr<FJsonObject>;
FString String(const JObject& J,const TCHAR* K){FString V;if(J)J->TryGetStringField(K,V);return V;}
double Number(const JObject& J,const TCHAR* K,double Fallback=0){double V;if(J&&J->TryGetNumberField(K,V)&&FMath::IsFinite(V))return V;return Fallback;}
bool Bool(const JObject& J,const TCHAR* K,bool Fallback=false){bool V;if(J&&J->TryGetBoolField(K,V))return V;return Fallback;}
const TArray<TSharedPtr<FJsonValue>>& Array(const JObject& J,const TCHAR* K){static TArray<TSharedPtr<FJsonValue>> Empty;const TArray<TSharedPtr<FJsonValue>>* V=nullptr;return J&&J->TryGetArrayField(K,V)?*V:Empty;}
JObject Object(const JObject& J,const TCHAR* K){const JObject* V=nullptr;return J&&J->TryGetObjectField(K,V)?*V:nullptr;}
bool Parse(const FString& JSON,JObject& Out){return JSON.Len()<64*1024*1024&&FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(JSON),Out)&&Out.IsValid();}
FVector Vector(const TArray<TSharedPtr<FJsonValue>>& A,int32 Offset=0){if(A.Num()<Offset+3)return FVector::ZeroVector;return FVector(A[Offset]->AsNumber(),A[Offset+2]->AsNumber(),A[Offset+1]->AsNumber());}
FLinearColor Color(const TArray<TSharedPtr<FJsonValue>>& A){return A.Num()>=3?FLinearColor(A[0]->AsNumber(),A[1]->AsNumber(),A[2]->AsNumber(),A.Num()>3?A[3]->AsNumber():1):FLinearColor::White;}
}
UJsGameBridgeComponent::UJsGameBridgeComponent(){PrimaryComponentTick.bCanEverTick=false;}
bool UJsGameBridgeComponent::SetAssetRegistry(const FString& JSON){JObject Root;if(!Parse(JSON,Root))return false;const JObject Map=Object(Root,TEXT("assets"));if(!Map)return false;Assets.Reset();for(const auto& Pair:Map->Values)if(Pair.Value->Type==EJson::Object)Assets.Add(FString(*Pair.Key),Pair.Value->AsObject());return true;}
FTransform UJsGameBridgeComponent::Transform(const JObject& R)const {
 const auto& M=Array(R,TEXT("matrix"));
 if(M.Num()==16){for(const auto& V:M)if(V->Type!=EJson::Number||!FMath::IsFinite(V->AsNumber()))return FTransform::Identity;
  const FVector X=Vector(M,0),Y=Vector(M,8),Z=Vector(M,4),T=Vector(M,12)*UnitsToCentimeters;
  return FTransform(FMatrix(FPlane(X,0),FPlane(Y,0),FPlane(Z,0),FPlane(T,1)));
 }
 return FTransform(FQuat::Identity,Vector(Array(R,TEXT("position")))*UnitsToCentimeters);
}
USceneComponent* UJsGameBridgeComponent::CreateEntity(const FString& Id,const JObject& R){
 AActor* Owner=GetOwner();if(!Owner)return nullptr;
 if(!Owner->GetRootComponent()){auto* Root=NewObject<USceneComponent>(Owner);Owner->SetRootComponent(Root);Root->RegisterComponent();}
 const FString Kind=String(R,TEXT("kind")),Key=String(R,TEXT("asset"));const JObject A=Assets.FindRef(Key);USceneComponent* C=nullptr;
 if(Kind==TEXT("camera")){C=NewObject<UCameraComponent>(Owner);}
 else if(Kind==TEXT("pointLight"))C=NewObject<UPointLightComponent>(Owner);
 else if(Kind==TEXT("spotLight"))C=NewObject<USpotLightComponent>(Owner);
 else if(Kind==TEXT("directionalLight"))C=NewObject<UDirectionalLightComponent>(Owner);
 else if(Kind==TEXT("mesh")&&!String(A,TEXT("mesh")).IsEmpty()){
  auto* Mesh=NewObject<UStaticMeshComponent>(Owner);Mesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,*String(A,TEXT("mesh"))));Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);C=Mesh;
 }else if(Kind==TEXT("mesh")){auto* Mesh=NewObject<UProceduralMeshComponent>(Owner);Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);C=Mesh;}
 else C=NewObject<USceneComponent>(Owner);
 C->SetMobility(EComponentMobility::Movable);C->SetupAttachment(Owner->GetRootComponent());C->RegisterComponent();Entities.Add(Id,C);return C;
}
void UJsGameBridgeComponent::UpdateMaterial(USceneComponent* C,const JObject& R){
 auto* Primitive=Cast<UPrimitiveComponent>(C);if(!Primitive)return;
 const FString MaterialKey=String(R,TEXT("material"));const JObject A=Assets.FindRef(MaterialKey);const FString Path=String(A,TEXT("material"));
 const FString CacheKey=String(R,TEXT("id"))+TEXT(":")+MaterialKey;
 UMaterialInstanceDynamic* D=Materials.FindRef(CacheKey).Get();
 if(!D){UMaterialInterface* Parent=Path.IsEmpty()?Primitive->GetMaterial(0):LoadObject<UMaterialInterface>(nullptr,*Path);if(!Parent)Parent=UMaterial::GetDefaultMaterial(MD_Surface);D=UMaterialInstanceDynamic::Create(Parent,this);Materials.Add(CacheKey,D);}
 Primitive->SetMaterial(0,D);
 const JObject P=Object(R,TEXT("parameters"));if(!P)return;
 for(const auto& Pair:P->Values){const FName Name(*Pair.Key);if(Pair.Value->Type==EJson::Number){const double V=Pair.Value->AsNumber();if(FMath::IsFinite(V))D->SetScalarParameterValue(Name,V);}else if(Pair.Value->Type==EJson::Array)D->SetVectorParameterValue(Name,Color(Pair.Value->AsArray()));}
}
void UJsGameBridgeComponent::ApplyEvent(const JObject& E){
 const JObject A=Assets.FindRef(String(E,TEXT("key")));if(!A)return;const FTransform T=Transform(E);const FString Kind=String(E,TEXT("kind"));
 if(Kind==TEXT("effect")){if(auto* System=LoadObject<UNiagaraSystem>(nullptr,*String(A,TEXT("niagara"))))if(auto* C=UNiagaraFunctionLibrary::SpawnSystemAtLocation(GetWorld(),System,T.GetLocation(),T.Rotator(),T.GetScale3D())){
  if(const JObject P=Object(E,TEXT("parameters")))for(const auto& Pair:P->Values){if(Pair.Value->Type==EJson::Number)C->SetVariableFloat(FName(*Pair.Key),Pair.Value->AsNumber());else if(Pair.Value->Type==EJson::Array)C->SetVariableVec3(FName(*Pair.Key),Vector(Pair.Value->AsArray()));}
 }}else if(Kind==TEXT("sound")){if(auto* Sound=LoadObject<USoundBase>(nullptr,*String(A,TEXT("sound"))))UGameplayStatics::PlaySoundAtLocation(this,Sound,T.GetLocation(),Number(E,TEXT("volume"),1),Number(E,TEXT("pitch"),1));}
 else if(Kind==TEXT("decal")){if(auto* Material=LoadObject<UMaterialInterface>(nullptr,*String(A,TEXT("material"))))UGameplayStatics::SpawnDecalAtLocation(this,Material,T.GetScale3D()*UnitsToCentimeters,T.GetLocation(),T.Rotator(),Number(E,TEXT("duration"),5));}
 else if(Kind==TEXT("cameraShake")){if(auto* PC=UGameplayStatics::GetPlayerController(this,0))if(PC->PlayerCameraManager)if(auto* Class=LoadClass<UCameraShakeBase>(nullptr,*String(A,TEXT("cameraShake"))))PC->PlayerCameraManager->StartCameraShake(Class,Number(E,TEXT("scale"),1));}
}
bool UJsGameBridgeComponent::ApplyScene(const FString& JSON){
 check(IsInGameThread());JObject Frame;if(!Parse(JSON,Frame)||Number(Frame,TEXT("version"))!=1)return false;
 const int64 Sequence=Number(Frame,TEXT("sequence"),-1);if(Sequence<=LastSequence)return false;LastSequence=Sequence;
 for(const auto& V:Array(Frame,TEXT("chunks"))){if(V->Type!=EJson::Object)continue;const JObject R=V->AsObject();const FString Id=String(R,TEXT("id"));const int64 Revision=Number(R,TEXT("revision"));if(Id.IsEmpty()||ChunkVersions.FindRef(Id)==Revision)continue;
  const auto& P=Array(R,TEXT("positions"));const auto& I=Array(R,TEXT("indices"));if(P.Num()%3||P.Num()>3000000||I.Num()>3000000)continue;
  TArray<FVector> Positions,Normals;TArray<int32> Indices;TArray<FVector2D> UV;TArray<FLinearColor> Colors;TArray<FProcMeshTangent> Tangents;
  bool Valid=true;for(int32 N=0;N<P.Num();N+=3){if(P[N]->Type!=EJson::Number||P[N+1]->Type!=EJson::Number||P[N+2]->Type!=EJson::Number){Valid=false;break;}FVector Point=Vector(P,N)*UnitsToCentimeters;if(Point.ContainsNaN()){Valid=false;break;}Positions.Add(Point);}if(!Valid)continue;
  for(const auto& Index:I){const int32 N=Index->AsNumber();if(N<0||N>=Positions.Num()){Valid=false;break;}Indices.Add(N);}if(!Valid||Indices.Num()%3)continue;for(int32 N=0;N<Indices.Num();N+=3)Swap(Indices[N+1],Indices[N+2]);
  // Three (X,Y,Z) -> Unreal (X,Z,Y) is a reflection; reverse triangle winding.
  const auto& Ns=Array(R,TEXT("normals"));for(int32 N=0;N+2<Ns.Num();N+=3)Normals.Add(Vector(Ns,N));
  const auto& Cs=Array(R,TEXT("colors"));if(Cs.Num()==Positions.Num()*4)for(int32 N=0;N<Cs.Num();N+=4)Colors.Add(FLinearColor(Cs[N]->AsNumber(),Cs[N+1]->AsNumber(),Cs[N+2]->AsNumber(),Cs[N+3]->AsNumber()));
  const auto& Us=Array(R,TEXT("uv"));for(int32 N=0;N+1<Us.Num();N+=2)UV.Add(FVector2D(Us[N]->AsNumber(),Us[N+1]->AsNumber()));
  auto* Mesh=Chunks.FindRef(Id).Get();if(!Mesh){Mesh=NewObject<UProceduralMeshComponent>(GetOwner());Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);Mesh->RegisterComponent();Chunks.Add(Id,Mesh);}
  Mesh->CreateMeshSection_LinearColor(0,Positions,Indices,Normals,UV,Colors,Tangents,false);Mesh->SetVisibility(false);ChunkVersions.Add(Id,Revision);
 }
 TSet<FString> Seen;
 for(const auto& V:Array(Frame,TEXT("entities"))){if(V->Type!=EJson::Object)continue;const JObject R=V->AsObject();const FString Id=String(R,TEXT("id"));if(Id.IsEmpty())continue;Seen.Add(Id);auto* C=Entities.FindRef(Id).Get();const FString Binding=String(R,TEXT("kind"))+TEXT(":")+String(R,TEXT("asset"));
  if(C&&EntityAssetBindings.FindRef(Id)!=Binding){C->DestroyComponent();Entities.Remove(Id);EntityGeometryBindings.Remove(Id);C=nullptr;}
  if(!C){C=CreateEntity(Id,R);EntityAssetBindings.Add(Id,Binding);}if(!C)continue;
  C->SetWorldTransform(Transform(R));C->SetVisibility(Bool(R,TEXT("visible"),true),true);
  if(auto* Mesh=Cast<UProceduralMeshComponent>(C)){
   const FString Geometry=String(R,TEXT("geometry")),GeometryBinding=Geometry+TEXT(":")+LexToString(ChunkVersions.FindRef(Geometry));
   if(EntityGeometryBindings.FindRef(Id)!=GeometryBinding){if(auto* Source=Chunks.FindRef(Geometry).Get()){if(const FProcMeshSection* Section=Source->GetProcMeshSection(0)){Mesh->SetProcMeshSection(0,*Section);EntityGeometryBindings.Add(Id,GeometryBinding);}}else{Mesh->ClearAllMeshSections();EntityGeometryBindings.Remove(Id);}}
  }
  if(auto* Light=Cast<ULightComponent>(C)){Light->SetIntensity(Number(R,TEXT("intensity"),1));Light->SetLightColor(Color(Array(R,TEXT("color"))));if(Array(R,TEXT("target")).Num()==3){const FVector Target=Vector(Array(R,TEXT("target")))*UnitsToCentimeters;Light->SetWorldRotation((Target-Light->GetComponentLocation()).Rotation());}if(auto* Point=Cast<UPointLightComponent>(Light))Point->SetAttenuationRadius(Number(R,TEXT("distance"),100)*UnitsToCentimeters);if(auto* Spot=Cast<USpotLightComponent>(Light))Spot->SetOuterConeAngle(FMath::RadiansToDegrees(Number(R,TEXT("angle"),.5)));}
  if(auto* Camera=Cast<UCameraComponent>(C)){const double Aspect=Number(R,TEXT("aspect"),16./9.);Camera->SetAspectRatio(Aspect);const auto& CM=Array(R,TEXT("matrix"));if(CM.Num()==16)Camera->SetWorldRotation(FRotationMatrix::MakeFromXZ(-Vector(CM,8).GetSafeNormal(),Vector(CM,4).GetSafeNormal()).Rotator());Camera->SetFieldOfView(FMath::RadiansToDegrees(2*FMath::Atan(FMath::Tan(FMath::DegreesToRadians(Number(R,TEXT("fov"),50)*.5))*Aspect)));Camera->bConstrainAspectRatio=false;if(auto* PC=UGameplayStatics::GetPlayerController(this,0))PC->SetViewTarget(GetOwner());}
  UpdateMaterial(C,R);
 }
 for(auto It=Entities.CreateIterator();It;++It)if(!Seen.Contains(It.Key())){if(It.Value())It.Value()->DestroyComponent();EntityGeometryBindings.Remove(It.Key());EntityAssetBindings.Remove(It.Key());const FString Prefix=It.Key()+TEXT(":");for(auto Material=Materials.CreateIterator();Material;++Material)if(Material.Key().StartsWith(Prefix))Material.RemoveCurrent();It.RemoveCurrent();}
 // Instanced batches are keyed by asset/material, with transforms replaced as a
 // group. Numerous particles/rocks do not allocate a separate actor per item.
 TSet<FString> BatchSeen;
 for(const auto& V:Array(Frame,TEXT("instances"))){if(V->Type!=EJson::Object)continue;const JObject R=V->AsObject();const FString Id=String(R,TEXT("id"));const JObject A=Assets.FindRef(String(R,TEXT("asset")));if(Id.IsEmpty()||!A)continue;BatchSeen.Add(Id);auto* C=Instances.FindRef(Id).Get();if(!C){C=NewObject<UInstancedStaticMeshComponent>(GetOwner());C->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,*String(A,TEXT("mesh"))));C->SetCollisionEnabled(ECollisionEnabled::NoCollision);C->RegisterComponent();Instances.Add(Id,C);}UpdateMaterial(C,R);C->ClearInstances();for(const auto& Pose:Array(R,TEXT("transforms")))if(Pose->Type==EJson::Object)C->AddInstance(Transform(Pose->AsObject()),true);}
 for(auto It=Instances.CreateIterator();It;++It)if(!BatchSeen.Contains(It.Key())){It.Value()->DestroyComponent();It.RemoveCurrent();}
 for(const auto& V:Array(Frame,TEXT("events")))if(V->Type==EJson::Object)ApplyEvent(V->AsObject());
 for(const auto& V:Array(Frame,TEXT("releaseChunks"))){const FString Id=V->AsString();if(auto* C=Chunks.FindRef(Id).Get())C->DestroyComponent();Chunks.Remove(Id);ChunkVersions.Remove(Id);}
 return true;
}
void UJsGameBridgeComponent::SendAction(const FString& Key,const FString& ParametersJSON){JObject P;if(!Parse(ParametersJSON,P))return;auto A=MakeShared<FJsonObject>();A->SetStringField(TEXT("action"),Key);A->SetObjectField(TEXT("parameters"),P);FString Text;FJsonSerializer::Serialize(A,TJsonWriterFactory<>::Create(&Text));OnAction.Broadcast(Text);}
void UJsGameBridgeComponent::ResetScene(){for(auto& P:Entities)if(P.Value)P.Value->DestroyComponent();for(auto& P:Chunks)if(P.Value)P.Value->DestroyComponent();for(auto& P:Instances)if(P.Value)P.Value->DestroyComponent();Entities.Reset();Chunks.Reset();Instances.Reset();Materials.Reset();ChunkVersions.Reset();EntityGeometryBindings.Reset();EntityAssetBindings.Reset();LastSequence=-1;}
void UJsGameBridgeComponent::EndPlay(const EEndPlayReason::Type Reason){ResetScene();Super::EndPlay(Reason);}
