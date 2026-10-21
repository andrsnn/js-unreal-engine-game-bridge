// CEF (Chromium Embedded Framework) for the bridge's own copy of Unreal's WebBrowser module (WebBrowserCef).
// Unreal 5.8 ships CEF 128. Tools/install-cef.ps1 downloads the CEF version below from cef-builds.spotifycdn.com,
// builds libcef_dll_wrapper and the render-process helper (JsgbWebHelper.exe), and lays them out in
// ThirdParty/CEF<major>/: include/, lib/ (libcef.lib, libcef_dll_wrapper.lib) and Win64/ (everything that ships).
using UnrealBuildTool;
using System.IO;

public class CEF3Cef : ModuleRules
{
	public const string CefVersion = "152.0.14+g8a0b5b9+chromium-152.0.7977.167";
	public const string CefFolder = "CEF152";

	public CEF3Cef(ReadOnlyTargetRules Target) : base(Target)
	{
		Type = ModuleType.External;
		IWYUSupport = IWYUSupport.None;
		if (Target.Platform != UnrealTargetPlatform.Win64 || Target.Architecture == UnrealArch.Arm64 || !Target.bCompileCEF3) { return; }

		string Root = Path.Combine(PluginDirectory, "ThirdParty", CefFolder);
		if (!Directory.Exists(Path.Combine(Root, "Win64")))
		{
			throw new BuildException("CEF " + CefVersion + " is missing from " + Root + ". Run Tools/install-cef.ps1 first.");
		}
		PublicSystemIncludePaths.Add(Root);
		// Unreal's WebBrowser code has CEF 147 paths behind this switch (Epic's experimental CEF in 5.8).
		PublicDefinitions.Add("CEF3_USE_EXPERIMENTAL_VERSION=1");
		PublicDefinitions.Add("JSGB_CEF_FOLDER=\"" + CefFolder + "\"");
		PublicAdditionalLibraries.Add(Path.Combine(Root, "lib", "libcef.lib"));
		PublicAdditionalLibraries.Add(Path.Combine(Root, "lib", "libcef_dll_wrapper.lib"));
		PublicDelayLoadDLLs.Add("libcef.dll");
		PublicDelayLoadDLLs.Add("chrome_elf.dll");
		PublicDelayLoadDLLs.Add("d3dcompiler_47.dll");
		foreach (string FilePath in Directory.EnumerateFiles(Path.Combine(Root, "Win64"), "*", SearchOption.AllDirectories))
		{
			RuntimeDependencies.Add(FilePath);
		}
	}
}
