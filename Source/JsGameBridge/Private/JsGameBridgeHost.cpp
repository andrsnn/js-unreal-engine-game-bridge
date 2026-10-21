#include "JsGameBridgeHost.h"
#include "JsGameBridgeComponent.h"
#include "JsEnv.h"
#include "JSModuleLoader.h"
#include "JSLogger.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "UnrealClient.h"
#include "Misc/SecureHash.h"
THIRD_PARTY_INCLUDES_START
#include <openssl/sha.h>
THIRD_PARTY_INCLUDES_END
#include "GameFramework/Actor.h"
#include "HttpServerModule.h"
#include "IHttpRouter.h"
#include "HttpServerResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
namespace {
bool VerifyPublication(const FString& BundlePath,const FString& PublicationPath,FString& Commit,FString& Hash){
 FString Metadata;TSharedPtr<FJsonObject> Publication;
 if(!FFileHelper::LoadFileToString(Metadata,*PublicationPath)||!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Metadata),Publication)||!Publication)return false;
if(!Publication->TryGetStringField(TEXT("sourceCommit"),Commit)||!Publication->TryGetStringField(TEXT("bundleSHA256"),Hash)||Commit.Len()!=40||Hash.Len()!=64)return false;
 if(!FPaths::FileExists(BundlePath))return false;
 TArray<uint8> Bytes;if(!FFileHelper::LoadFileToArray(Bytes,*BundlePath)||Bytes.Num()>64*1024*1024)return false;
 uint8 Digest[SHA256_DIGEST_LENGTH];SHA256(Bytes.GetData(),Bytes.Num(),Digest);
 const FString ActualHash=BytesToHex(Digest,SHA256_DIGEST_LENGTH).ToLower();if(ActualHash!=Hash)return false;
 return true;
}
class FBridgeModuleLoader final:public PUERTS_NAMESPACE::DefaultJSModuleLoader {
public:
 FBridgeModuleLoader():DefaultJSModuleLoader(TEXT("JavaScript")){}
 bool Search(const FString& Dir,const FString& Module,FString& Path,FString& Absolute)override{
  if(!FPaths::IsRelative(Module)&&CheckExists(Module,Path,Absolute))return true;
  return DefaultJSModuleLoader::Search(Dir,Module,Path,Absolute);
 }
};
}
UJsGameBridgeHost::UJsGameBridgeHost(){PrimaryComponentTick.bCanEverTick=true;}
bool UJsGameBridgeHost::Boot(const FString& BundlePath,const FString& PublicationPath){
 FString Commit,Hash;
 if(!FPaths::FileExists(BootstrapPath)||!VerifyPublication(BundlePath,PublicationPath,Commit,Hash))return false;
 OnFrame.Clear();OnInput.Clear();Environment.Reset();bReady=false;bReloadRequested=false;UIHTML.Reset();UILayoutMessages=0;SceneFrames=0;++BootGeneration;BinaryFiles.Reset();
 if(!Renderer){Renderer=NewObject<UJsGameBridgeComponent>(GetOwner());Renderer->RegisterComponent();}else Renderer->ResetScene();
 FString Registry;if(!AssetRegistryPath.IsEmpty()&&FFileHelper::LoadFileToString(Registry,*AssetRegistryPath)&&!Renderer->SetAssetRegistry(Registry))return false;
 SourceCommit=Commit;BundleSHA256=Hash;CurrentBundle=BundlePath;CurrentPublication=PublicationPath;
 Environment=MakeShared<PUERTS_NAMESPACE::FJsEnv>(std::make_shared<FBridgeModuleLoader>(),std::make_shared<PUERTS_NAMESPACE::FDefaultLogger>(),-1);
 TArray<TPair<FString,UObject*>> Args;Args.Emplace(TEXT("Host"),this);
 Environment->Start(BootstrapPath,Args);
 UE_LOG(LogTemp,Display,TEXT("JsGameBridge boot source=%s bundle=%s ready=%d"),*SourceCommit,*CurrentBundle,bReady);
 return StartReloadServer();
}
void UJsGameBridgeHost::TickComponent(float DeltaTime,ELevelTick TickType,FActorComponentTickFunction* Function){Super::TickComponent(DeltaTime,TickType,Function);Step(DeltaTime);}
void UJsGameBridgeHost::SendInput(const FString& JSON){TSharedPtr<FJsonObject> Input;FString Type;if(FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(JSON),Input)&&Input&&Input->TryGetStringField(TEXT("type"),Type)&&Type==TEXT("host-layout"))++UILayoutMessages;if(OnInput.IsBound())OnInput.Execute(JSON);}
void UJsGameBridgeHost::PublishUI(const FString& HTML){UIHTML=HTML;}
FString UJsGameBridgeHost::StorageDirectory()const{return FPaths::ProjectSavedDir()/TEXT("JsGameBridge")/FMD5::HashAnsiString(*AssetRoot);}
FString UJsGameBridgeHost::StoragePath(const FString& Key)const{return StorageDirectory()/(FMD5::HashAnsiString(*Key)+TEXT(".json"));}
bool UJsGameBridgeHost::HasStorage(const FString& Key,bool bSession){return bSession?SessionStorage.Contains(Key):FPaths::FileExists(StoragePath(Key));}
FString UJsGameBridgeHost::LoadStorage(const FString& Key,bool bSession){if(bSession)return SessionStorage.FindRef(Key);FString Value;FFileHelper::LoadFileToString(Value,*StoragePath(Key));return Value;}
void UJsGameBridgeHost::SaveStorage(const FString& Key,const FString& Value,bool bSession){if(bSession){SessionStorage.Add(Key,Value);return;}IFileManager::Get().MakeDirectory(*StorageDirectory(),true);FFileHelper::SaveStringToFile(Value,*StoragePath(Key),FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);}
void UJsGameBridgeHost::RemoveStorage(const FString& Key,bool bSession){if(bSession)SessionStorage.Remove(Key);else IFileManager::Get().Delete(*StoragePath(Key));}
void UJsGameBridgeHost::ClearStorage(bool bSession){if(bSession)SessionStorage.Reset();else IFileManager::Get().DeleteDirectory(*StorageDirectory(),false,true);}
void UJsGameBridgeHost::RequestReload(){bReloadRequested=true;bReady=false;}
void UJsGameBridgeHost::Step(double Seconds){
 // Dispose the previous V8 environment only after its input/frame callback has
 // returned. SessionStorage intentionally survives the browser-style reload.
 if(bReloadRequested){const FString Bundle=PendingBundle.IsEmpty()?CurrentBundle:MoveTemp(PendingBundle),Publication=CurrentPublication;bReloadRequested=false;if(!Boot(Bundle,Publication))Report(TEXT("Reload failed publication validation"));}
 if(OnFrame.IsBound())OnFrame.Execute(Seconds);
}
bool UJsGameBridgeHost::ApplyScene(const FString& JSON){const bool Accepted=Renderer&&Renderer->ApplyScene(JSON);if(Accepted)++SceneFrames;return Accepted;}
void UJsGameBridgeHost::Report(const FString& Details){UE_LOG(LogTemp,Display,TEXT("JsGameBridge JS %s"),*Details);}
void UJsGameBridgeHost::Ready(const FString& Details){bReady=true;UE_LOG(LogTemp,Display,TEXT("JsGameBridge READY %s"),*Details);}
FString UJsGameBridgeHost::ResolveAssetPath(const FString& Path)const{FString Root=FPaths::ConvertRelativePathToFull(AssetRoot);FPaths::NormalizeDirectoryName(Root);FString Relative=Path;while(Relative.StartsWith(TEXT("/")))Relative.RightChopInline(1);if(Relative.Contains(TEXT(".."))||Relative.Contains(TEXT(":")))return FString();if(Relative.StartsWith(TEXT("@source/")))return Root/Relative.Mid(8);
 if(Relative.StartsWith(TEXT("@bundle/")))return FPaths::GetPath(CurrentBundle)/Relative.Mid(8);
 return Root/TEXT("public")/Relative;}
FString UJsGameBridgeHost::ReadText(const FString& Path){FString Result,Resolved=Path==TEXT("@registry")?AssetRegistryPath:ResolveAssetPath(Path);if(!Resolved.IsEmpty())FFileHelper::LoadFileToString(Result,*Resolved);return Result;}
FArrayBuffer UJsGameBridgeHost::ReadBytes(const FString& Path){FArrayBuffer Result{nullptr,0,true};const FString Resolved=ResolveAssetPath(Path);if(Resolved.IsEmpty())return Result;auto* Data=BinaryFiles.Find(Resolved);if(!Data){TArray<uint8> Bytes;if(!FFileHelper::LoadFileToArray(Bytes,*Resolved)||Bytes.Num()>256*1024*1024)return Result;Data=&BinaryFiles.Add(Resolved,MoveTemp(Bytes));}Result.Data=Data->GetData();Result.Length=Data->Num();return Result;}
bool UJsGameBridgeHost::StartReloadServer(){
 if(Router)return true;Router=FHttpServerModule::Get().GetHttpRouter(ReloadPort,true);if(!Router)return false;
 const TWeakObjectPtr<UJsGameBridgeHost> Weak(this);
 ReloadHandle=Router->RegisterRequestPreprocessor(FHttpRequestHandler::CreateLambda([Weak](const FHttpServerRequest& Request,const FHttpResultCallback& Complete){
  const FString Route=Request.FullPath.GetPath();
  if(Route.StartsWith(TEXT("/bridge/ui/assets/"))&&Request.Verb==EHttpServerRequestVerbs::VERB_GET&&Weak.IsValid()){
   const FString Asset=Route.Mid(18);const FArrayBuffer Buffer=Weak->ReadBytes(Asset);
   if(!Buffer.Data||!Buffer.Length){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::NotFound));return true;}
   TArray<uint8> Body;Body.Append(static_cast<const uint8*>(Buffer.Data),Buffer.Length);
   const FString Ext=FPaths::GetExtension(Asset).ToLower();
   FString Mime=TEXT("application/octet-stream");
   if(Ext==TEXT("png"))Mime=TEXT("image/png");else if(Ext==TEXT("jpg")||Ext==TEXT("jpeg"))Mime=TEXT("image/jpeg");else if(Ext==TEXT("svg"))Mime=TEXT("image/svg+xml");else if(Ext==TEXT("ogg"))Mime=TEXT("audio/ogg");else if(Ext==TEXT("wav"))Mime=TEXT("audio/wav");else if(Ext==TEXT("woff2"))Mime=TEXT("font/woff2");
   Complete(FHttpServerResponse::Create(MoveTemp(Body),Mime));return true;
  }
  if(Route==TEXT("/bridge/ui/snapshot")&&Request.Verb==EHttpServerRequestVerbs::VERB_GET&&Weak.IsValid()){
   Complete(FHttpServerResponse::Create(Weak->UIHTML,TEXT("text/html; charset=utf-8")));return true;
  }
  if((Route==TEXT("/bridge/input")||Route==TEXT("/bridge/close")||Route==TEXT("/bridge/capture"))&&Request.Verb==EHttpServerRequestVerbs::VERB_POST&&Weak.IsValid()){
   if(!FParse::Param(FCommandLine::Get(),TEXT("JsAllowRemoteInput"))){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::Forbidden));return true;}
   if(Route==TEXT("/bridge/capture")){
    FString Directory;if(!FParse::Value(FCommandLine::Get(),TEXT("JsCaptureRoot="),Directory)){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::BadRequest));return true;}
    FString Body=FString(FUTF8ToTCHAR(reinterpret_cast<const ANSICHAR*>(Request.Body.GetData()),Request.Body.Num()));TSharedPtr<FJsonObject> Capture;FString Name;
    if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body),Capture)||!Capture||!Capture->TryGetStringField(TEXT("name"),Name)||Name.IsEmpty()||Name.Contains(TEXT("/"))||Name.Contains(TEXT("\\"))||Name.Contains(TEXT(".."))){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::BadRequest));return true;}
    IFileManager::Get().MakeDirectory(*Directory,true);const FString Output=Directory/(Name+TEXT(".png"));FScreenshotRequest::RequestScreenshot(Output,true,false);
    auto Receipt=MakeShared<FJsonObject>();Receipt->SetStringField(TEXT("path"),Output);FString Text;FJsonSerializer::Serialize(Receipt,TJsonWriterFactory<>::Create(&Text));Complete(FHttpServerResponse::Create(Text,TEXT("application/json")));return true;
   }
   if(Route==TEXT("/bridge/close")){Complete(FHttpServerResponse::Create(TEXT("{\"closing\":true}"),TEXT("application/json")));FPlatformMisc::RequestExit(false);return true;}
   if(Request.Body.Num()>65536||!Weak->bReady){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::BadRequest));return true;}
   FString Input=FString(FUTF8ToTCHAR(reinterpret_cast<const ANSICHAR*>(Request.Body.GetData()),Request.Body.Num()));TSharedPtr<FJsonObject> ParsedInput;
   if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Input),ParsedInput)||!ParsedInput){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::BadRequest));return true;}
   Weak->SendInput(Input);Complete(FHttpServerResponse::Create(TEXT("{\"accepted\":true}"),TEXT("application/json")));return true;
  }
  if(Request.FullPath.GetPath()==TEXT("/bridge/status")&&Request.Verb==EHttpServerRequestVerbs::VERB_GET&&Weak.IsValid()){
   auto Receipt=MakeShared<FJsonObject>();Receipt->SetStringField(TEXT("sourceCommit"),Weak->SourceCommit);Receipt->SetStringField(TEXT("bundleSHA256"),Weak->BundleSHA256);Receipt->SetBoolField(TEXT("ready"),Weak->bReady);Receipt->SetNumberField(TEXT("bootGeneration"),Weak->BootGeneration);Receipt->SetNumberField(TEXT("sceneFrames"),Weak->SceneFrames);Receipt->SetNumberField(TEXT("uiLayoutMessages"),Weak->UILayoutMessages);FString Text;FJsonSerializer::Serialize(Receipt,TJsonWriterFactory<>::Create(&Text));Complete(FHttpServerResponse::Create(Text,TEXT("application/json")));return true;
  }
  if(Request.FullPath.GetPath()!=TEXT("/bridge/reload"))return false;
  if(Request.Verb!=EHttpServerRequestVerbs::VERB_POST||Request.Body.Num()>65536||!Weak.IsValid()){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::BadRequest));return true;}
  FString Body=FString(FUTF8ToTCHAR(reinterpret_cast<const ANSICHAR*>(Request.Body.GetData()),Request.Body.Num()));TSharedPtr<FJsonObject> JSON;
  FString Path,Commit,Hash;if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body),JSON)||!JSON||!JSON->TryGetStringField(TEXT("bundlePath"),Path)||!JSON->TryGetStringField(TEXT("sourceCommit"),Commit)||!JSON->TryGetStringField(TEXT("bundleSHA256"),Hash)){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::BadRequest));return true;}
  if(FPaths::GetPath(FPaths::ConvertRelativePathToFull(Path))!=FPaths::GetPath(FPaths::ConvertRelativePathToFull(Weak->CurrentBundle))){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::Forbidden));return true;}
  FString PublishedCommit,PublishedHash;
  if(!VerifyPublication(Path,Weak->CurrentPublication,PublishedCommit,PublishedHash)||PublishedCommit!=Commit||PublishedHash!=Hash){Complete(FHttpServerResponse::Error(EHttpServerResponseCodes::BadRequest,TEXT("Publication identity mismatch")));return true;}
  // Acknowledge verified bytes now; rebuilding V8 is deferred until the next
  // host tick, outside the HTTP request and previous JS callback stack.
  Weak->PendingBundle=Path;Weak->SourceCommit=Commit;Weak->BundleSHA256=Hash;Weak->RequestReload();
  auto Receipt=MakeShared<FJsonObject>();Receipt->SetStringField(TEXT("sourceCommit"),Commit);Receipt->SetStringField(TEXT("bundleSHA256"),Hash);Receipt->SetBoolField(TEXT("ready"),false);FString Text;FJsonSerializer::Serialize(Receipt,TJsonWriterFactory<>::Create(&Text));auto Response=FHttpServerResponse::Create(Text,TEXT("application/json"));Response->Code=EHttpServerResponseCodes::Accepted;Complete(MoveTemp(Response));return true;
 }));FHttpServerModule::Get().StartAllListeners();return true;
}
void UJsGameBridgeHost::Shutdown(){if(Router){Router->UnregisterRequestPreprocessor(ReloadHandle);Router.Reset();}OnFrame.Clear();OnInput.Clear();Environment.Reset();if(Renderer)Renderer->ResetScene();BinaryFiles.Reset();bReady=false;bReloadRequested=false;}
void UJsGameBridgeHost::EndPlay(const EEndPlayReason::Type Reason){Shutdown();Super::EndPlay(Reason);}
