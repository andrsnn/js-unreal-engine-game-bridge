@echo off
rem Adds a live HUD label to the orbit demo. A running browser and Unreal both reload.
cd /d "%~dp0.."
node Tools\demo.mjs feature on
timeout /t 3 >nul
