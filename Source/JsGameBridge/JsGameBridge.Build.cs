using UnrealBuildTool;
public class JsGameBridge : ModuleRules {
 public JsGameBridge(ReadOnlyTargetRules Target):base(Target){
  AddEngineThirdPartyPrivateStaticDependencies(Target,"OpenSSL");
  // FreeType rasterizes canvas text (fillText) with the game's fonts or the engine's Roboto.
  AddEngineThirdPartyPrivateStaticDependencies(Target,"FreeType2");
  AddEngineThirdPartyPrivateStaticDependencies(Target,"UElibPNG");
  AddEngineThirdPartyPrivateStaticDependencies(Target,"zlib");
  PCHUsage=PCHUsageMode.UseExplicitOrSharedPCHs;
  PublicDependencyModuleNames.AddRange(new[]{"Core","CoreUObject","Engine","Json","JsonUtilities","ProceduralMeshComponent","Niagara","RenderCore","RHI","JsEnv","HTTPServer","Slate","SlateCore","InputCore","ApplicationCore","WebBrowser",
   "MeshDescription","StaticMeshDescription","ImageWrapper","Projects","AudioMixer","VorbisAudioDecoder"});
  // FSoundQualityInfo for the runtime Ogg Vorbis decoder.
  PrivateIncludePathModuleNames.Add("TargetPlatform");
 }
}
