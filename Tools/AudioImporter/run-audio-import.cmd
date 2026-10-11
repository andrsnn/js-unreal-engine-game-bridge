@echo off
setlocal
if "%~1"=="" exit /b 2
if not exist "%~f1" exit /b 3
set "JSGAME_AUDIO_MANIFEST=%~f1"
set "JSGAME_AUDIO_MODE=%~2"
if "%JSGAME_AUDIO_MODE%"=="" set "JSGAME_AUDIO_MODE=import"
set "JSGAME_AUDIO_REPORT=G:\JsGameBridge\Tools\AudioImporter\reports\%~n1-%JSGAME_AUDIO_MODE%.json"
if exist "%JSGAME_AUDIO_REPORT%" del /q "%JSGAME_AUDIO_REPORT%"
"F:\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "G:\JsGameBridge\Tools\AudioImporter\ContentOnlyProject\AudioImporter.uproject" -run=pythonscript -script="G:\JsGameBridge\Tools\AudioImporter\ue_audio_import.py" -nullrhi -unattended -nosplash -nop4 -nosound -NoLiveCoding -NoShaderCompile -stdout -FullStdOutLogOutput -abslog="G:\JsGameBridge\Tools\AudioImporter\reports\%~n1-%JSGAME_AUDIO_MODE%.log" > "G:\JsGameBridge\Tools\AudioImporter\reports\%~n1-%JSGAME_AUDIO_MODE%-console.log" 2>&1
set "AUDIO_ENGINE_EXIT=%ERRORLEVEL%"
if not "%AUDIO_ENGINE_EXIT%"=="0" exit /b %AUDIO_ENGINE_EXIT%
powershell.exe -NoProfile -Command "$r=Get-Content -Raw -LiteralPath $env:JSGAME_AUDIO_REPORT | ConvertFrom-Json; if(-not $r.ok){exit 5}"
exit /b %ERRORLEVEL%
