@echo off
rem Root must explicitly release the shared browser lane before this command.
rem Default: fresh native shield patrol then Smuggler's Cut. Optional SFX_DELVE=platform-2.
rem Run: saltblade-shield-delve-native-film.cmd --browser-released
node G:\sfx\saltblade-shield-delve-native-film.mjs %*
