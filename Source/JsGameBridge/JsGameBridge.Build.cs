using UnrealBuildTool;
public class JsGameBridge : ModuleRules {
 public JsGameBridge(ReadOnlyTargetRules Target):base(Target){
  AddEngineThirdPartyPrivateStaticDependencies(Target,"OpenSSL");
  PCHUsage=PCHUsageMode.UseExplicitOrSharedPCHs;
  PublicDependencyModuleNames.AddRange(new[]{"Core","CoreUObject","Engine","Json","JsonUtilities","ProceduralMeshComponent","Niagara","RenderCore","JsEnv","HTTPServer","Slate","SlateCore","InputCore","ApplicationCore","WebBrowser"});
 }
}
