@echo off
rem Double-click: like Play in Unreal, with NVIDIA DLSS (Quality mode) and an FPS readout.
rem Needs an NVIDIA RTX GPU and the NVIDIA DLSS plugin in the host project (see README).
rem Without them the game runs with Unreal's TSR at the same render scale.
setlocal
cd /d "%~dp0"
set GAME=%~1
if "%GAME%"=="" set GAME=hardburn-demo
if "%GAME%"=="hardburn-demo" node Tools\demo.mjs prepare hardburn || goto :fail
node Tools\jsgb.mjs unreal %GAME% --dlss quality --hud || goto :fail
goto :eof
:fail
echo.
echo The messages above say what went wrong.
pause
