# Moves a Puerts 1.0.5 plugin (with Patches/puerts-thread-safe.patch applied) onto V8 13.6.233.17:
# the headers and wee8.lib that Patches/build-v8-13.6.cmd built, and Patches/puerts-v8-13.6.patch for the API changes
# between V8 9.4 and 13.6. Build the host afterwards; the old V8 9.4 folder stays, so reversing the patch goes back.
#   powershell -File Patches/install-puerts-v8-13.6.ps1 -Puerts <project>/Plugins/Puerts [-V8 C:/Builds/v8src/v8/v8]
param([Parameter(Mandatory = $true)][string]$Puerts, [string]$V8 = 'C:/Builds/v8src/v8/v8')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$lib = Join-Path $V8 'out.gn/x64.release/obj/wee8.lib'
if (-not (Test-Path $lib)) { throw "no $lib; run Patches/build-v8-13.6.cmd first" }
$dest = Join-Path $Puerts 'ThirdParty/v8_13.6.233.17'
New-Item -ItemType Directory -Force (Join-Path $dest 'Lib/Win64MD') | Out-Null
robocopy (Join-Path $V8 'include') (Join-Path $dest 'Inc') /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item $lib (Join-Path $dest 'Lib/Win64MD/wee8.lib') -Force
# One comparison in a V8 header compares signed with unsigned, and Unreal builds treat that warning (C4018) as an error.
$h = Join-Path $dest 'Inc/v8-internal.h'
$text = [IO.File]::ReadAllText($h)
$text = $text.Replace('    return value <= std::numeric_limits<int32_t>::max();', '    return value <= static_cast<std::make_unsigned_t<int32_t>>(std::numeric_limits<int32_t>::max());')
[IO.File]::WriteAllText($h, $text)
# git's messages go through cmd, so Windows PowerShell doesn't turn them into errors.
$patch = Join-Path $here 'puerts-v8-13.6.patch'
Push-Location $Puerts
try {
  cmd /c "git apply --reverse --check --ignore-whitespace `"$patch`" 2>nul"
  if ($LASTEXITCODE -eq 0) { 'puerts-v8-13.6.patch is already applied' }
  else { cmd /c "git apply --ignore-whitespace `"$patch`" 2>&1"; if ($LASTEXITCODE -ne 0) { throw 'puerts-v8-13.6.patch did not apply' }; 'applied puerts-v8-13.6.patch' }
} finally { Pop-Location }
"Puerts at $Puerts now builds against V8 13.6.233.17"
