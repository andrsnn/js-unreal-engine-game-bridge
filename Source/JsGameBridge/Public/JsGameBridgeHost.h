#pragma once
#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "ArrayBuffer.h"
#include "PuertsNamespaceDef.h"
#include "JsGameBridgeHost.generated.h"
namespace PUERTS_NAMESPACE {class FJsEnv;}
class UJsGameBridgeComponent;
class IHttpRouter;
DECLARE_DYNAMIC_DELEGATE_OneParam(FJsGameFrame,double,Seconds);
DECLARE_DYNAMIC_DELEGATE_OneParam(FJsGameInput,const FString&,JSON);
UCLASS(ClassGroup=(Scripting),meta=(BlueprintSpawnableComponent))
class JSGAMEBRIDGE_API UJsGameBridgeHost : public UActorComponent {
 GENERATED_BODY()
public:
 UJsGameBridgeHost();
 UFUNCTION(BlueprintCallable) bool Boot(const FString& BundlePath,const FString& PublicationPath);
 UFUNCTION(BlueprintCallable) void Shutdown();
 UFUNCTION(BlueprintCallable) void RequestReload();
 UFUNCTION(BlueprintCallable) void Step(double Seconds);
 UFUNCTION(BlueprintCallable) void SendInput(const FString& JSON);
 UFUNCTION(BlueprintCallable) void PublishUI(const FString& HTML);
 UFUNCTION(BlueprintCallable) bool HasStorage(const FString& Key,bool bSession=false);
 UFUNCTION(BlueprintCallable) FString LoadStorage(const FString& Key,bool bSession=false);
 UFUNCTION(BlueprintCallable) void SaveStorage(const FString& Key,const FString& Value,bool bSession=false);
 UFUNCTION(BlueprintCallable) void RemoveStorage(const FString& Key,bool bSession=false);
 UFUNCTION(BlueprintCallable) void ClearStorage(bool bSession=false);
 UFUNCTION(BlueprintCallable) bool IsReady()const{return bReady;}
 UFUNCTION(BlueprintCallable) FString GetBundlePath()const{return CurrentBundle;}
 UPROPERTY(BlueprintReadOnly) FString UIHTML;
 UFUNCTION(BlueprintCallable) bool ApplyScene(const FString& JSON);
 UFUNCTION(BlueprintCallable) void Report(const FString& Details);
 UFUNCTION(BlueprintCallable) void Ready(const FString& Details);
 UFUNCTION(BlueprintCallable) FString ReadText(const FString& Path);
 UFUNCTION(BlueprintCallable) FArrayBuffer ReadBytes(const FString& Path);
 UPROPERTY() FJsGameFrame OnFrame;
 UPROPERTY() FJsGameInput OnInput;
 UPROPERTY(EditAnywhere) FString AssetRoot;
 UPROPERTY(EditAnywhere) FString BootstrapPath;
 UPROPERTY(EditAnywhere) FString AssetRegistryPath;
 UPROPERTY(BlueprintReadOnly) FString SourceCommit;
 UPROPERTY(BlueprintReadOnly) FString BundleSHA256;
 UPROPERTY(BlueprintReadOnly) bool bReady=false;
 UPROPERTY(BlueprintReadOnly) int32 BootGeneration=0;
 UPROPERTY(BlueprintReadOnly) int64 SceneFrames=0;
 UPROPERTY(EditAnywhere) int32 ReloadPort=5292;
 virtual void TickComponent(float DeltaTime,ELevelTick TickType,FActorComponentTickFunction* ThisTickFunction) override;
 virtual void EndPlay(const EEndPlayReason::Type Reason) override;
private:
 UPROPERTY() TObjectPtr<UJsGameBridgeComponent> Renderer;
 TSharedPtr<PUERTS_NAMESPACE::FJsEnv> Environment;
 TSharedPtr<IHttpRouter> Router;
 FDelegateHandle ReloadHandle;
 TMap<FString,TArray<uint8>> BinaryFiles;
 TMap<FString,FString> SessionStorage;
 FString StorageDirectory()const;
 FString StoragePath(const FString& Key)const;
 FString CurrentBundle,CurrentPublication,PendingBundle;
 int32 UILayoutMessages=0;
 bool bReloadRequested=false;
 bool StartReloadServer();
 FString ResolveAssetPath(const FString& Path) const;
};
