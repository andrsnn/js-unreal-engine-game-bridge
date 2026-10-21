using UnrealBuildTool;
public class JsGameBridge : ModuleRules {
 public JsGameBridge(ReadOnlyTargetRules Target):base(Target){
  // The browser (WebBrowserCef, CEF3UtilsCef and CEF 152) comes from Tools/setup-cef152.ps1, which copies two modules
  // from your own Unreal install and downloads CEF. It is required; nothing here builds without it.
  if(!System.IO.File.Exists(System.IO.Path.Combine(PluginDirectory,"Source","WebBrowserCef","WebBrowserCef.Build.cs"))||!System.IO.Directory.Exists(System.IO.Path.Combine(PluginDirectory,"ThirdParty","CEF152","Win64")))
   throw new BuildException("JsGameBridge: run Tools/setup-cef152.ps1 once before building (powershell -ExecutionPolicy Bypass -File \""+System.IO.Path.Combine(PluginDirectory,"Tools","setup-cef152.ps1")+"\"). It sets up the browser on CEF 152.");
  AddEngineThirdPartyPrivateStaticDependencies(Target,"OpenSSL");
  // FreeType rasterizes canvas text (fillText) with the game's fonts or the engine's Roboto.
  AddEngineThirdPartyPrivateStaticDependencies(Target,"FreeType2");
  AddEngineThirdPartyPrivateStaticDependencies(Target,"UElibPNG");
  AddEngineThirdPartyPrivateStaticDependencies(Target,"zlib");
  // Ogg Opus files (Chrome plays them; Unreal's runtime decoder reads only Ogg Vorbis).
  AddEngineThirdPartyPrivateStaticDependencies(Target,"libOpus");
  PCHUsage=PCHUsageMode.UseExplicitOrSharedPCHs;
  PublicDependencyModuleNames.AddRange(new[]{"Core","CoreUObject","Engine","Json","JsonUtilities","ProceduralMeshComponent","Niagara","RenderCore","RHI","JsEnv","HTTPServer","Slate","SlateCore","InputCore","ApplicationCore",
   "MeshDescription","StaticMeshDescription","ImageWrapper","ImageCore","MovieSceneCapture","Projects","AudioMixer","VorbisAudioDecoder"});
  // Games use the bridge's copy of Unreal's WebBrowser module on a current CEF (Source/WebBrowserCef,
  // Tools/install-cef.ps1). The editor keeps the engine's WebBrowser (CEF 128): it loads that module itself, and two
  // modules with the same UObject headers can't be in one target.
  PublicDependencyModuleNames.Add(Target.Type == TargetType.Editor ? "WebBrowser" : "WebBrowserCef");
  // FSoundQualityInfo for the runtime Ogg Vorbis decoder.
  PrivateIncludePathModuleNames.Add("TargetPlatform");
 }
}
