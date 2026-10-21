# Required once per checkout, before the first build: sets up the bridge's browser on CEF 152 (Chromium 152).
#
# Unreal 5.8 ships CEF 128 inside its WebBrowser module. The bridge builds its own copy of that module against CEF 152:
#   1. copies WebBrowser and CEF3Utils from YOUR Unreal Engine install into Source\WebBrowserCef and Source\CEF3UtilsCef
#      (Epic's source never goes into this repository; both folders are in .gitignore),
#   2. applies the bridge's changes to those copies with the edits listed below,
#   3. runs Tools\install-cef.ps1, which downloads CEF 152 from the official CEF builds (cef-builds.spotifycdn.com),
#      checks its SHA1, builds libcef_dll_wrapper and the render-process helper JsgbWebHelper.exe, and puts them in
#      ThirdParty\CEF152.
#
#   powershell -ExecutionPolicy Bypass -File Tools\setup-cef152.ps1 [-EngineDir "C:\Program Files\Epic Games\UE_5.8"] [-SkipCef]
#
# Needs Unreal Engine 5.8 (from the Epic Games Launcher or built from source) and Visual Studio 2022 or later with
# "Desktop development with C++" (MSVC, CMake and Ninja). -SkipCef redoes steps 1 and 2 only.
param(
  [string]$EngineDir = '',
  [switch]$SkipCef
)
$ErrorActionPreference = 'Stop'
$Plugin = Split-Path $PSScriptRoot -Parent

function Find-Engine {
  if ($EngineDir) { return $EngineDir }
  if ($env:UE_ENGINE_DIR) { return $env:UE_ENGINE_DIR }
  foreach ($k in Get-ChildItem 'HKLM:\SOFTWARE\EpicGames\Unreal Engine' -ErrorAction SilentlyContinue | Sort-Object PSChildName -Descending) {
    $d = (Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue).InstalledDirectory
    if ($d -and $k.PSChildName -like '5.*' -and (Test-Path "$d\Engine\Source\Runtime\WebBrowser")) { return $d }
  }
  foreach ($d in 'C:\Program Files\Epic Games\UE_5.8', 'D:\Epic Games\UE_5.8', 'E:\Epic Games\UE_5.8', 'F:\UE_5.8') {
    if (Test-Path "$d\Engine\Source\Runtime\WebBrowser") { return $d }
  }
  throw 'Could not find Unreal Engine 5. Pass -EngineDir "<folder that has Engine\Source>" or set UE_ENGINE_DIR.'
}
$Engine = (Resolve-Path (Find-Engine)).Path
$Runtime = Join-Path $Engine 'Engine\Source\Runtime'
foreach ($m in 'WebBrowser', 'CEF3Utils') { if (-not (Test-Path "$Runtime\$m")) { throw "$Runtime\$m is missing. Is $Engine an Unreal Engine 5 folder?" } }
Write-Host "Unreal Engine: $Engine"

# --- 1. copy the two modules from the engine -------------------------------------------------------------------------
$Wb = Join-Path $Plugin 'Source\WebBrowserCef'
$Cu = Join-Path $Plugin 'Source\CEF3UtilsCef'
foreach ($d in $Wb, $Cu) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
Copy-Item -Recurse "$Runtime\WebBrowser" $Wb
Copy-Item -Recurse "$Runtime\CEF3Utils" $Cu
# Launcher installs mark engine files read-only.
Get-ChildItem -Recurse -File $Wb, $Cu | ForEach-Object { $_.IsReadOnly = $false }
# Only Windows uses the bridge's CEF; the other platforms' folders would not build against it.
foreach ($p in "$Wb\Private\Android", "$Wb\Private\Apple", "$Wb\WebBrowser_UPL.xml", "$Cu\Private\Mac") { if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
Move-Item "$Wb\WebBrowser.Build.cs" "$Wb\WebBrowserCef.Build.cs"
Move-Item "$Cu\CEF3Utils.Build.cs" "$Cu\CEF3UtilsCef.Build.cs"

# --- 2. the bridge's changes -----------------------------------------------------------------------------------------
# Each edit finds a short piece of the engine's text and replaces it. If Epic changed that text in your engine version,
# the script stops and names the file and the edit, so nothing is built from a half-edited copy.
function Read-Text($f) { [IO.File]::ReadAllText($f).Replace("`r`n", "`n") }
function Write-Text($f, $t) { [IO.File]::WriteAllText($f, $t.Replace("`n", "`r`n"), (New-Object Text.UTF8Encoding($false))) }
function Edit($file, $find, $replace, [switch]$Regex, [switch]$All) {
  $t = Read-Text $file
  $find = $find.Replace("`r`n", "`n"); $replace = $replace.Replace("`r`n", "`n")
  $n = if ($Regex) { [regex]::Matches($t, $find).Count } else { ([regex]::Matches($t, [regex]::Escape($find))).Count }
  if ($n -eq 0 -or ($n -gt 1 -and -not $All)) {
    throw "setup-cef152: edit not applied to $file (found $n matches for: $($find.Substring(0, [Math]::Min(80, $find.Length))))`nThis engine version differs from the one the edits were written for (Unreal 5.8)."
  }
  if ($Regex) { $t = [regex]::Replace($t, $find, $replace) } else { $t = $t.Replace($find, $replace) }
  Write-Text $file $t
}
function Rename-Api($dir, $from, $to) {
  foreach ($f in Get-ChildItem -Recurse -File $dir -Include *.h, *.cpp, *.inl) {
    $t = Read-Text $f.FullName
    $u = [regex]::Replace($t, "\b$from\b", $to)
    if ($u -ne $t) { Write-Text $f.FullName $u }
  }
}

# Module names and export macros, so the copies can sit next to the engine's own modules.
Rename-Api $Wb 'WEBBROWSER_API' 'WEBBROWSERCEF_API'
Rename-Api $Cu 'CEF3UTILS_API' 'CEF3UTILSCEF_API'
Edit "$Wb\Private\WebBrowserModule.cpp" 'IMPLEMENT_MODULE( FWebBrowserModule, WebBrowser );' 'IMPLEMENT_MODULE( FWebBrowserModule, WebBrowserCef );'
Edit "$Wb\Public\WebBrowserModule.h" 'LoadModuleChecked< IWebBrowserModule >("WebBrowser")' 'LoadModuleChecked< IWebBrowserModule >("WebBrowserCef")'
Edit "$Wb\Public\WebBrowserModule.h" 'IsModuleLoaded("WebBrowser")' 'IsModuleLoaded("WebBrowserCef")'
Edit "$Cu\Private\CEF3Utils.cpp" 'IMPLEMENT_MODULE(FDefaultModuleImpl, CEF3Utils);' 'IMPLEMENT_MODULE(FDefaultModuleImpl, CEF3UtilsCef);'

# Build rules: link CEF 152 (Source\ThirdParty\CEF3Cef) instead of the engine's CEF3, and ship JsgbWebHelper.exe with
# the CEF files instead of EpicWebHelper.exe.
$WbRules = "$Wb\WebBrowserCef.Build.cs"
Edit $WbRules 'public class WebBrowser : ModuleRules' 'public class WebBrowserCef : ModuleRules'
Edit $WbRules 'public WebBrowser(ReadOnlyTargetRules Target)' 'public WebBrowserCef(ReadOnlyTargetRules Target)'
Edit $WbRules 'PrivateDependencyModuleNames.Add("CEF3Utils");' 'PrivateDependencyModuleNames.Add("CEF3UtilsCef");'
Edit $WbRules 'AddEngineThirdPartyPrivateStaticDependencies(Target, "CEF3");' 'PrivateDependencyModuleNames.Add("CEF3Cef");'
Edit $WbRules '(?s)if \(Target\.Type != TargetType\.Server\)\s*\{\s*if \(Target\.Platform == UnrealTargetPlatform\.Mac.*?EpicWebHelper\.exe"\);\s*\}\s*\}\s*\}' '// JsgbWebHelper.exe ships with the CEF files (CEF3Cef), not as Engine/Binaries/Win64/EpicWebHelper.exe.' -Regex
$CuRules = "$Cu\CEF3UtilsCef.Build.cs"
Edit $CuRules 'public class CEF3Utils : ModuleRules' 'public class CEF3UtilsCef : ModuleRules'
Edit $CuRules 'public CEF3Utils(ReadOnlyTargetRules Target)' 'public CEF3UtilsCef(ReadOnlyTargetRules Target)'
Edit $CuRules '"Core",' '"Core", "Projects",'
Edit $CuRules 'AddEngineThirdPartyPrivateStaticDependencies\(Target,\s*"CEF3"\s*\);' 'PublicDependencyModuleNames.Add("CEF3Cef");' -Regex

# CEF3Utils: load libcef.dll from the plugin (ThirdParty\CEF152\Win64) instead of Engine\Binaries\ThirdParty\CEF3.
Edit "$Cu\Public\CEF3Utils.h" 'CEF3UTILSCEF_API void UnloadCEF3Modules();' @"
CEF3UTILSCEF_API void UnloadCEF3Modules();

	/** The folder with libcef.dll, its resources and JsgbWebHelper.exe (JsGameBridge/ThirdParty/CEF<major>/Win64). */
	CEF3UTILSCEF_API FString GetCEF3Dir();
"@
Edit "$Cu\Private\CEF3Utils.cpp" "#if WITH_CEF3`nnamespace CEF3Utils`n{`n" @"
#if WITH_CEF3
#include "Interfaces/IPluginManager.h"
namespace CEF3Utils
{
	FString GetCEF3Dir()
	{
		FString Base = FPaths::Combine(FPaths::ProjectPluginsDir(), TEXT("JsGameBridge"));
		if (TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(TEXT("JsGameBridge")))
		{
			Base = Plugin->GetBaseDir();
		}
		return FPaths::ConvertRelativePathToFull(FPaths::Combine(Base, TEXT("ThirdParty"), TEXT(JSGB_CEF_FOLDER), TEXT("Win64")));
	}


"@
Edit "$Cu\Private\CEF3Utils.cpp" '(?s)\t#if PLATFORM_CPU_ARM_FAMILY && !PLATFORM_WINDOWS_ARM64EC\n[^\n]*\n\s*#else\n[^\n]*CEF_VERSION_SUFFIX\);\n\s*#endif\n' @"
		// The bridge's CEF lives in the JsGameBridge plugin (ThirdParty/CEF<major>/Win64), not in the engine.
		DllPath = GetCEF3Dir();

"@ -Regex
# CEF 150 and later build ANGLE into libcef.dll, so libGLESv2.dll and libEGL.dll may not exist.
Edit "$Cu\Private\CEF3Utils.cpp" 'GLESHandle = LoadDllCEF(FPaths::Combine(*DllPath, TEXT("libGLESv2.dll")));' '// CEF 150 and later build ANGLE into libcef.dll, so these two may not exist.
			if (FPaths::FileExists(FPaths::Combine(*DllPath, TEXT("libGLESv2.dll")))) { GLESHandle = LoadDllCEF(FPaths::Combine(*DllPath, TEXT("libGLESv2.dll"))); }'
Edit "$Cu\Private\CEF3Utils.cpp" 'EGLHandle = LoadDllCEF(FPaths::Combine(*DllPath, TEXT("libEGL.dll")));' 'if (FPaths::FileExists(FPaths::Combine(*DllPath, TEXT("libEGL.dll")))) { EGLHandle = LoadDllCEF(FPaths::Combine(*DllPath, TEXT("libEGL.dll"))); }'

# WebBrowserSingleton: resources and the helper exe from the plugin's CEF folder, no per-browser user_agent_product
# (an Epic patch to CEF; stock CEF only has the global setting), and saves carried over from the engine's CEF 128.
$Ws = "$Wb\Private\WebBrowserSingleton.cpp"
Edit $Ws '#include "Misc/Paths.h"' "#include `"Misc/Paths.h`"`n#include `"Misc/FileHelper.h`""
Edit $Ws '(?m)^(\t+)FString ResourcesPath\(FPaths::Combine\(\*FPaths::EngineDir\(\), CEF3_RESOURCES_DIR\)\);' @"
#if PLATFORM_WINDOWS
`$1// The bridge's CEF keeps its resources next to libcef.dll (JsGameBridge/ThirdParty/CEF<major>/Win64).
`$1FString ResourcesPath(CEF3Utils::GetCEF3Dir());
#else
`$1FString ResourcesPath(FPaths::Combine(*FPaths::EngineDir(), CEF3_RESOURCES_DIR));
#endif
"@ -Regex
Edit $Ws '(?m)^(\t+)FString SubProcessPath\(FPaths::Combine\(\*FPaths::EngineDir\(\), CEF3_SUBPROCES_EXE\)\);' @"
#if PLATFORM_WINDOWS
`$1// The bridge's render-process helper, built against the same CEF (Tools/JsgbWebHelper).
`$1FString SubProcessPath(FPaths::Combine(CEF3Utils::GetCEF3Dir(), TEXT("JsgbWebHelper.exe")));
#else
`$1FString SubProcessPath(FPaths::Combine(*FPaths::EngineDir(), CEF3_SUBPROCES_EXE));
#endif
"@ -Regex
Edit $Ws "#if PLATFORM_WINDOWS || PLATFORM_LINUX`n`t`tCefString(&BrowserSettings.user_agent_product)" "#if (PLATFORM_WINDOWS || PLATFORM_LINUX) && 0`n`t`tCefString(&BrowserSettings.user_agent_product)"
Edit $Ws '(?m)^(\t+)(FString CachePath = FPaths::ConvertRelativePathToFull\(GenerateWebCacheFolderName\(CachePathBase\)\);)\n' "`$1`$2`n`$1JsgbCopyWebStorageFromOlderCef(FPaths::ConvertRelativePathToFull(CachePathBase), CachePath);`n" -Regex
Edit $Ws 'FString FWebBrowserSingleton::ApplicationCacheDir() const' ((Read-Text "$PSScriptRoot\setup-cef152\CopyWebStorage.inl") + "`nFString FWebBrowserSingleton::ApplicationCacheDir() const")

# Check that every change landed.
foreach ($check in @(
    @($Ws, 'JsgbCopyWebStorageFromOlderCef(FPaths'), @($Ws, 'JsgbWebHelper.exe'), @("$Cu\Private\CEF3Utils.cpp", 'DllPath = GetCEF3Dir();'),
    @($WbRules, '"CEF3Cef"'), @($CuRules, '"CEF3Cef"'))) {
  if (-not (Read-Text $check[0]).Contains($check[1])) { throw "setup-cef152: $($check[0]) is missing '$($check[1])' after the edits" }
}
if ((Read-Text $WbRules).Contains('EpicWebHelper.exe")')) { throw "setup-cef152: $WbRules still stages EpicWebHelper.exe" }
Set-Content -Encoding ascii "$Wb\.jsgb-setup" "Copied from $Engine by Tools\setup-cef152.ps1 on $(Get-Date -Format s)"
Write-Host "WebBrowserCef and CEF3UtilsCef are ready in $Plugin\Source"

# --- 3. CEF 152 ------------------------------------------------------------------------------------------------------
if (-not $SkipCef) { & "$PSScriptRoot\install-cef.ps1" }
Write-Host 'setup-cef152 done. Build the host as usual.'
