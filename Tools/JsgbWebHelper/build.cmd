@echo off
rem Builds JsgbWebHelper.exe against the CEF in ..\..\ThirdParty\%1 (for example CEF152) and puts it in its Win64 folder.
rem Needs Visual Studio's x64 build tools (vcvars64.bat) on the path or VSVARS set to it.
setlocal
set CEFDIR=%~dp0..\..\ThirdParty\%1
if not exist "%CEFDIR%\include\cef_app.h" ( echo CEF headers missing in %CEFDIR% & exit /b 1 )
if not defined VSVARS set VSVARS=C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat
call "%VSVARS%" >nul || exit /b 1
set OUT=%TEMP%\jsgbwebhelper-%RANDOM%
mkdir "%OUT%"
cl /nologo /O2 /MD /EHsc /std:c++20 /DNDEBUG /DUNICODE /D_UNICODE /DNOMINMAX /DWIN32_LEAN_AND_MEAN /I"%CEFDIR%" /Fo"%OUT%\\" "%~dp0JsgbWebHelper.cpp" ^
  /link /SUBSYSTEM:WINDOWS /OUT:"%CEFDIR%\Win64\JsgbWebHelper.exe" /MANIFEST:EMBED /MANIFESTINPUT:"%~dp0JsgbWebHelper.manifest" ^
  "%CEFDIR%\lib\libcef.lib" "%CEFDIR%\lib\libcef_dll_wrapper.lib" user32.lib advapi32.lib shell32.lib || exit /b 1
rmdir /s /q "%OUT%"
echo HELPER-OK %CEFDIR%\Win64\JsgbWebHelper.exe
