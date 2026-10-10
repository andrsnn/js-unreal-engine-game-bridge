@echo off
rem Adds the demo feature (a live HUD label) to the demo copy of Hard Burn. Both running targets reload.
cd /d "%~dp0.."
node Tools\demo.mjs feature on
timeout /t 3 >nul
