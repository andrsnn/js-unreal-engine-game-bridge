@echo off
ffprobe -v error -show_entries format=duration,size:stream=index,codec_name,width,height,sample_rate,channels -of json C:\UnlitWorldsCaptures\judge\saltblade-audio-v5.mp4 > G:\sfx\evidence\saltblade\desert-weather-1791677597072\ffprobe.json
if errorlevel 1 exit /b 1
ffmpeg -hide_banner -loglevel error -y -ss 20 -i C:\UnlitWorldsCaptures\judge\saltblade-audio-v5.mp4 -frames:v 1 G:\sfx\evidence\saltblade\desert-weather-1791677597072\giant.png
