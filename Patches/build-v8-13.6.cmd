@echo off
rem Builds V8 13.6.233.17 as one static library (wee8.lib, dynamic CRT) for Puerts, the way puerts/backend-v8's
rem windows_64MD.cmd does, with its patches, but with WebAssembly and Maglev on. Puerts' own prebuilt has both off,
rem and the bridge needs WebAssembly (shader conversion, three.js model decoders in workers).
rem   Patches\build-v8-13.6.cmd [root]      root defaults to C:\Builds\v8src; needs git, node and Visual Studio 2022.
rem Takes about 15 minutes and 15 GB. The library lands in <root>\v8\v8\out.gn\x64.release\obj\wee8.lib and the headers
rem in <root>\v8\v8\include; Patches\install-puerts-v8-13.6.ps1 copies both into a Puerts plugin.
setlocal
set VERSION=13.6.233.17
set ROOT=%~1
if "%ROOT%"=="" set ROOT=C:\Builds\v8src
set SCRIPTS=%ROOT%\backend-v8
set PATH=%ROOT%\depot_tools;%PATH%
set DEPOT_TOOLS_WIN_TOOLCHAIN=0
set TEMP=%ROOT%\tmp
set TMP=%ROOT%\tmp
mkdir "%TEMP%" 2>nul
cd /d "%ROOT%"
if not exist depot_tools\gclient.bat (
  curl -sSL -o depot_tools.zip https://storage.googleapis.com/chrome-infra/depot_tools.zip || exit /b 1
  mkdir depot_tools
  tar -xf depot_tools.zip -C depot_tools || exit /b 1
)
if not exist backend-v8\patches (
  git clone --depth 1 https://github.com/puerts/backend-v8.git || exit /b 1
)
cd /d "%SCRIPTS%"
call npm i --silent || exit /b 1
cd /d "%ROOT%"
if not exist v8\.gclient (
  mkdir v8
  cd v8
  call gclient config --name v8 --unmanaged https://chromium.googlesource.com/v8/v8.git
  cd ..
)
cd /d "%ROOT%\v8"
if not exist v8\BUILD.gn (
  call git clone --depth 1 --branch %VERSION% https://chromium.googlesource.com/v8/v8.git v8 || exit /b 1
)
call gclient sync --no-history -D || exit /b 1
set DEPOT_TOOLS_UPDATE=0
cd /d "%ROOT%\v8\v8"
if not exist .puerts-patched (
  call git apply --ignore-whitespace "%SCRIPTS%\patches\enable_wee8_v13.6.233.17.patch" || exit /b 1
  call git apply --ignore-whitespace "%SCRIPTS%\patches\ephemeron_remembered_set_fix_v13.6.233.17.patch" || exit /b 1
  node "%SCRIPTS%\node-script\rep.js" build\config\win\BUILD.gn || exit /b 1
  node "%SCRIPTS%\node-script\add_arraybuffer_new_without_stl.js" . %VERSION% || exit /b 1
  node "%SCRIPTS%\node-script\patchs.js" . %VERSION% || exit /b 1
  echo done> .puerts-patched
)
call gn gen out.gn\x64.release --args="target_os=""win"" target_cpu=""x64"" v8_use_external_startup_data=false v8_enable_i18n_support=false is_debug=false v8_static_library=true is_clang=true use_custom_libcxx=false strip_debug_info=true symbol_level=0 v8_enable_pointer_compression=false v8_enable_sandbox=false v8_enable_maglev=true v8_enable_webassembly=true cppgc_enable_caged_heap=false treat_warnings_as_errors=false" || exit /b 1
call ninja -C out.gn\x64.release wee8 || exit /b 1
echo V8 %VERSION% built: %ROOT%\v8\v8\out.gn\x64.release\obj\wee8.lib
