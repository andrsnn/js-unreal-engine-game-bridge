#include "JsGameBridgeGameMode.h"
#include "JsGameBridgeHost.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "SWebBrowser.h"
#include "WebBrowserModule.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
AJsGameBridgeGameMode::AJsGameBridgeGameMode(){PrimaryActorTick.bCanEverTick=true;DefaultPawnClass=nullptr;}
void AJsGameBridgeGameMode::BeginPlay(){
 Super::BeginPlay();
 FString Bundle,SourceRoot,Bootstrap,Registry;
 FParse::Value(FCommandLine::Get(),TEXT("JsBundle="),Bundle);
 FParse::Value(FCommandLine::Get(),TEXT("JsSourceRoot="),SourceRoot);
 FParse::Value(FCommandLine::Get(),TEXT("JsBootstrap="),Bootstrap);
 FParse::Value(FCommandLine::Get(),TEXT("JsRegistry="),Registry);
 if(Bundle.IsEmpty()||SourceRoot.IsEmpty()||Bootstrap.IsEmpty()){
  UE_LOG(LogTemp,Error,TEXT("JsGameBridge needs JsBundle, JsSourceRoot and JsBootstrap host paths"));return;
 }
 BridgeActor=GetWorld()->SpawnActor<AActor>();
 Host=NewObject<UJsGameBridgeHost>(BridgeActor);
 BridgeActor->AddInstanceComponent(Host);Host->RegisterComponent();
 Host->AssetRoot=SourceRoot;Host->BootstrapPath=Bootstrap;Host->AssetRegistryPath=Registry;
 FParse::Value(FCommandLine::Get(),TEXT("JsReloadPort="),Host->ReloadPort);
 if(!Host->Boot(Bundle,FPaths::GetPath(Bundle)/TEXT("publication.json"))){UE_LOG(LogTemp,Error,TEXT("JsGameBridge publication rejected"));return;}
 HostBundle=Bundle;HostBootstrap=Bootstrap;InitializeViewport();
}
void AJsGameBridgeGameMode::InitializeViewport(){
 if(!Host||Browser||!GEngine||!GEngine->GameViewport||FParse::Param(FCommandLine::Get(),TEXT("nullrhi")))return;
 const FString& Bundle=HostBundle;const FString& Bootstrap=HostBootstrap;
 UE_LOG(LogTemp,Display,TEXT("JsGameBridge creating shared UI viewport"));
 FString CSS,Client;
 TArray<FString> Stylesheets;IFileManager::Get().FindFiles(Stylesheets,*(FPaths::GetPath(Bundle)/TEXT("*.css")),true,false);Stylesheets.Sort();
 for(const FString& Name:Stylesheets){FString Style;FFileHelper::LoadFileToString(Style,*(FPaths::GetPath(Bundle)/Name));CSS+=Style;}
 FFileHelper::LoadFileToString(Client,*(FPaths::GetPath(Bootstrap)/TEXT("UIClient.js")));
 if(Client.IsEmpty()){UE_LOG(LogTemp,Error,TEXT("JsGameBridge UI client missing"));return;}
 // Direct Slate users must load the module; SWebBrowserView only checks
 // availability because its usual UMG caller initializes it first.
 if(!IWebBrowserModule::Get().IsWebModuleAvailable()){UE_LOG(LogTemp,Error,TEXT("JsGameBridge CEF module unavailable"));return;}
 SAssignNew(Browser,SWebBrowser).InitialURL(TEXT("about:blank"))
  .ShowControls(false).ShowAddressBar(false).ShowInitialThrobber(false)
  .SupportsTransparency(true).BackgroundColor(FColor::Transparent).BrowserFrameRate(60)
  .PopupMenuMethod(EPopupMethod::UseCurrentWindow)
  .OnLoadStarted_Lambda([this](){bDocumentReady=false;})
  .OnLoadCompleted_Lambda([this](){bDocumentReady=true;LastHTML.Reset();UE_LOG(LogTemp,Display,TEXT("JsGameBridge shared UI document loaded"));})
  .OnLoadError_Lambda([](){UE_LOG(LogTemp,Error,TEXT("JsGameBridge UI document failed to load"));})
  .OnConsoleMessage_Lambda([](const FString& Message,const FString& Source,int32 Line,EWebBrowserConsoleLogSeverity Severity){UE_LOG(LogTemp,Display,TEXT("JsGameBridge UI console %d %s:%d %s"),static_cast<int32>(Severity),*Source,Line,*Message.Left(2048));})
  .OnBeforePopup_Lambda([](FString,FString){return true;});
 Browser->BindUObject(TEXT("jsgame"),Host,true);
 GEngine->GameViewport->AddViewportWidgetContent(Browser.ToSharedRef(),100);
 const FString HTML=TEXT("<!doctype html><html><head><meta charset='utf-8'><base href='")+FString::Printf(TEXT("http://127.0.0.1:%d/bridge/ui/assets/"),Host->ReloadPort)+TEXT("'><style>")+CSS+
  TEXT("html,body,#gl{background:transparent!important}</style><script>")+Client+TEXT("</script></head><body></body></html>");
 Browser->LoadString(HTML,FString::Printf(TEXT("http://127.0.0.1:%d/bridge/ui/index.html"),Host->ReloadPort));
}
void AJsGameBridgeGameMode::Tick(float Seconds){
 Super::Tick(Seconds);
 InitializeViewport();
 if(!Host||!Browser)return;
 if(!bInputConfigured){if(auto* PC=GetWorld()->GetFirstPlayerController()){
  PC->bShowMouseCursor=true;FInputModeGameAndUI Mode;Mode.SetWidgetToFocus(Browser);Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);Mode.SetHideCursorDuringCapture(false);PC->SetInputMode(Mode);bInputConfigured=true;
 }}
 if(bDocumentReady&&!Host->UIHTML.IsEmpty()&&Host->UIHTML!=LastHTML){
  LastHTML=Host->UIHTML;auto Packet=MakeShared<FJsonObject>();Packet->SetStringField(TEXT("html"),LastHTML);FString JSON;FJsonSerializer::Serialize(Packet,TJsonWriterFactory<>::Create(&JSON));
  Browser->ExecuteJavascript(TEXT("window.JsGameUI&&window.JsGameUI.apply((")+JSON+TEXT(").html)"));
 }
}
void AJsGameBridgeGameMode::EndPlay(const EEndPlayReason::Type Reason){
 if(Browser){if(GEngine&&GEngine->GameViewport)GEngine->GameViewport->RemoveViewportWidgetContent(Browser.ToSharedRef());Browser->UnbindUObject(TEXT("jsgame"),Host,true);Browser.Reset();}
 if(Host)Host->Shutdown();if(BridgeActor)BridgeActor->Destroy();Super::EndPlay(Reason);
}
