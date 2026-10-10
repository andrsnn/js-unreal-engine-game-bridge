#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "JsGameBridgeGameMode.generated.h"
class UJsGameBridgeHost;
class SWebBrowser;
// Generic host only: no factions, recipes, campaign rules or game UI definitions.
UCLASS()
class JSGAMEBRIDGE_API AJsGameBridgeGameMode:public AGameModeBase {
 GENERATED_BODY()
public:
 AJsGameBridgeGameMode();
 virtual void BeginPlay() override;
 virtual void Tick(float DeltaSeconds) override;
 virtual void EndPlay(const EEndPlayReason::Type Reason) override;
private:
 UPROPERTY() TObjectPtr<AActor> BridgeActor;
 UPROPERTY() TObjectPtr<UJsGameBridgeHost> Host;
 TSharedPtr<SWebBrowser> Browser;
 void InitializeViewport();
 FString HostBundle,HostBootstrap,LastHTML;
 bool bDocumentReady=false,bInputConfigured=false;
};
