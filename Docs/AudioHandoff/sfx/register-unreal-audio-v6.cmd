@echo off
node G:\JsGameBridge\Tools\register-audio.mjs G:\sfx\karvos-unreal-audio-v5.json G:\sfx\unlit-unreal-audio-v5.json G:\sfx\hardburn-unreal-audio-v6.json --out=audio-cues-v6.json
if errorlevel 1 exit /b %errorlevel%
node G:\JsGameBridge\Tools\register-runtime-audio.mjs hardburn
