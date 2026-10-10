@echo off
rem Double-click: build the game, start it in Unreal, then hot-reload it on every save.
rem The Unreal window shows how long each reload took. Optional argument: a game from Games\.
setlocal
cd /d "%~dp0"
set GAME=%~1
if "%GAME%"=="" set GAME=hardburn-demo
if "%GAME%"=="hardburn-demo" node Tools\demo.mjs prepare hardburn || goto :fail
node Tools\jsgb.mjs unreal %GAME% || goto :fail
goto :eof
:fail
echo.
echo The messages above say what went wrong.
pause
