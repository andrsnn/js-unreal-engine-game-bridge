@echo off
rem Removes the demo feature from the demo copy of Hard Burn. Both running targets reload.
cd /d "%~dp0.."
node Tools\demo.mjs feature off
timeout /t 3 >nul
