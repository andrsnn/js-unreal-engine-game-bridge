#!/bin/bash
# make-clip.sh: a 60 second clip of the packaged game's battle with Lumen on, from the game's own frames (30 a second).
O=H:/captures/jsgb-goal; P=H:/builds/HardBurnUnreal-play
bash $O/ramcheck.sh 40; rm -rf $O/clip-frames; mkdir -p $O/clip-frames
"$P/host/Windows/JsgbHost.exe" "-JsgbGame=$(cygpath -w $P/games/hardburn)" -RenderOffScreen -ForceRes -ResX=1920 -ResY=1080 -JsgbDlssKeys -JsgbJitter -JsgbJsThread -JsgbVolume=0 -JsgbScript=$O/clip.txt -JsgbCapture=$O/clip-frames -JsgbCaptureFps=30 -JsgbFixedFps=30 -JsgbMaxSeconds=1500 -JsgbSeed=1234 "-JsgbSearch=?view=black" -unattended -log=jsgb-clip.log > /dev/null 2>&1 &
sleep 30; timeout 1560 bash -c "until ! tasklist | grep -qi 'JsgbHost.exe'; do sleep 10; done"; taskkill //F //IM JsgbHost.exe > /dev/null 2>&1
n=$(ls $O/clip-frames/frame_*.png 2>/dev/null | wc -l); echo "$n frames"
[ "$n" -gt 100 ] && ffmpeg -y -loglevel error -framerate 30 -i $O/clip-frames/frame_%05d.png -c:v libx264 -crf 18 -pix_fmt yuv420p $O/battle-clip.mp4 && ffprobe -v error -show_entries format=duration -of csv=p=0 $O/battle-clip.mp4
