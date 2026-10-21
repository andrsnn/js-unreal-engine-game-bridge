# Puts the CEF that WebBrowserCef builds against into ThirdParty\CEF<major>\ (headers, libs, the files that ship) and
# builds JsgbWebHelper.exe, the render-process helper, against it. Tools\setup-cef152.ps1 runs it. Run it on its own
# to redo only the CEF part:
#   powershell -ExecutionPolicy Bypass -File Tools\install-cef.ps1 [-Work <download and build folder>] [-VsVars <vcvars64.bat>]
# Needs Visual Studio's x64 C++ build tools with CMake and Ninja (the "Desktop development with C++" workload).
param(
  [string]$Version = '152.0.14+g8a0b5b9+chromium-152.0.7977.167',
  [string]$Sha1 = '0bad9c7d50f2fbf508bdf47e8f885590bb4d19ae',
  [string]$Work = (Join-Path $env:LOCALAPPDATA 'JsGameBridge\cef-work'),
  [string]$VsVars = ''
)
$ErrorActionPreference = 'Stop'
if (-not $VsVars) {
  # The newest Visual Studio that has the x64 C++ tools.
  $VsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path $VsWhere) {
    $Vs = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($Vs) { $VsVars = Join-Path $Vs 'VC\Auxiliary\Build\vcvars64.bat' }
  }
  if (-not $VsVars -or -not (Test-Path $VsVars)) { throw 'Visual Studio with the x64 C++ build tools was not found. Install the "Desktop development with C++" workload, or pass -VsVars <path to vcvars64.bat>.' }
}
$Root = Split-Path $PSScriptRoot -Parent
$Major = $Version.Split('.')[0]
$Dest = Join-Path $Root "ThirdParty\CEF$Major"
$Name = "cef_binary_${Version}_windows64_minimal"
New-Item -ItemType Directory -Force $Work | Out-Null
$Archive = Join-Path $Work "$Name.tar.bz2"
if (-not (Test-Path $Archive)) {
  $Url = 'https://cef-builds.spotifycdn.com/' + [uri]::EscapeDataString("$Name.tar.bz2")
  Write-Host "Downloading $Url"
  & curl.exe -sSfL -o $Archive $Url
  if ($LASTEXITCODE -ne 0) { throw "download failed" }
}
$Got = (Get-FileHash -Algorithm SHA1 $Archive).Hash.ToLower()
if ($Got -ne $Sha1) { throw "SHA1 $Got does not match $Sha1" }
$Src = Join-Path $Work $Name
if (-not (Test-Path $Src)) { & tar.exe -xjf $Archive -C $Work; if ($LASTEXITCODE -ne 0) { throw "extract failed" } }

# libcef_dll_wrapper with the DLL C runtime (/MD), as Unreal builds.
$Build = Join-Path $Work "build-$Major"
New-Item -ItemType Directory -Force $Build | Out-Null
$cmd = "call `"$VsVars`" >nul && cd /d `"$Build`" && cmake -G Ninja -DCMAKE_BUILD_TYPE=Release -DUSE_SANDBOX=OFF -DCEF_RUNTIME_LIBRARY_FLAG=/MD `"$Src`" && ninja libcef_dll_wrapper"
& cmd.exe /c $cmd
if ($LASTEXITCODE -ne 0) { throw "libcef_dll_wrapper build failed" }

New-Item -ItemType Directory -Force "$Dest\lib", "$Dest\Win64" | Out-Null
Copy-Item -Recurse -Force "$Src\include" $Dest
Copy-Item -Force "$Src\Release\libcef.lib", "$Build\libcef_dll_wrapper\libcef_dll_wrapper.lib" "$Dest\lib"
Get-ChildItem "$Src\Release" -File | Where-Object { $_.Extension -ne '.lib' -and $_.Name -notlike 'bootstrap*' } | Copy-Item -Destination "$Dest\Win64" -Force
Copy-Item -Recurse -Force "$Src\Resources\*" "$Dest\Win64"
# Licence notices ship next to libcef.dll: CEF (BSD) and Chromium with its third-party notices.
Copy-Item -Force "$Src\LICENSE.txt" "$Dest\Win64\CEF-LICENSE.txt"
Copy-Item -Force "$Src\CREDITS.html" "$Dest\Win64\CEF-CREDITS.html"

$env:VSVARS = $VsVars
& cmd.exe /c "`"$PSScriptRoot\JsgbWebHelper\build.cmd`" CEF$Major"
if ($LASTEXITCODE -ne 0) { throw "JsgbWebHelper build failed" }
Write-Host "CEF $Version ready in $Dest"
