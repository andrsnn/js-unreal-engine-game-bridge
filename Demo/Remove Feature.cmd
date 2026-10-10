@echo off
rem Removes the live HUD label from the orbit demo. A running browser and Unreal both reload.
cd /d "%~dp0.."
node Tools\demo.mjs feature off
timeout /t 3 >nul
