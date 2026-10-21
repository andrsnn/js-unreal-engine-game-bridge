@echo off
rem Double-click: serve the game with its own Vite dev server and open it in the browser.
rem Saving a file in the game's folder reloads the page. Optional argument: a game from Games\.
setlocal
cd /d "%~dp0"
set GAME=%~1
if "%GAME%"=="" set GAME=hardburn-demo
if "%GAME%"=="hardburn-demo" node Tools\demo.mjs prepare hardburn || goto :fail
node Tools\web.mjs dev %GAME% || goto :fail
goto :eof
:fail
echo.
echo The messages above say what went wrong.
pause
