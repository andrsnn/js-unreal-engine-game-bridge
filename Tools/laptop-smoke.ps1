# Verify each packaged game using only a process started by this script.
param([string]$Games)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$R=Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force "$R/smoke"|Out-Null
$Host_=''
function Post($route,$body){try{Invoke-RestMethod -Method Post -TimeoutSec 10 -Body $body "$Host_/$route"}catch{$null}}
function Status{try{Invoke-RestMethod -TimeoutSec 3 "$Host_/status"}catch{$null}}
function ScreenDiff($a,$b){
 $x=[System.Drawing.Bitmap]::FromFile($a);$y=[System.Drawing.Bitmap]::FromFile($b);$sum=0;$n=0
 try{for($i=1;$i -lt 40;$i++){for($j=1;$j -lt 40;$j++){
  $p=$x.GetPixel([int]($x.Width*$i/40),[int]($x.Height*$j/40));$q=$y.GetPixel([int]($y.Width*$i/40),[int]($y.Height*$j/40))
  $sum+=([math]::Abs($p.R-$q.R)+[math]::Abs($p.G-$q.G)+[math]::Abs($p.B-$q.B))/3;$n++
 }};[math]::Round($sum/$n,1)}finally{$x.Dispose();$y.Dispose()}
}
foreach($pair in $Games.Split(';')){
 $id,$name=$pair.Split('=');$process=$null
 try{
  $listener=New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback,0)
  $listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
  $Host_="http://127.0.0.1:$port/bridge"
  $log="$R/host/Windows/JsgbHost/Saved/Logs/jsgb-$id.log"
  Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
  $arguments="-JsgbGame=`"$R/games/$id`" -JsgbJsThread -JsgbAllowRemote -JsgbPort=$port -JsgbMaxSeconds=240 -RenderOffScreen -windowed -logPSO -log=jsgb-$id.log"
  $process=Start-Process -FilePath "$R/host/Windows/JsgbHost/Binaries/Win64/JsgbHost.exe" -WorkingDirectory "$R/host/Windows" -ArgumentList $arguments -WindowStyle Hidden -PassThru
  $t0=Get-Date;$s=$null
  while(((Get-Date)-$t0).TotalSeconds -lt 180 -and !$process.HasExited){Start-Sleep -Seconds 1;$s=Status;if($s -and $s.ready){break}}
  $ready=[int]((Get-Date)-$t0).TotalSeconds
  if(!$s -or !$s.ready){"$id FAIL: not ready after $ready s";continue}
  Start-Sleep -Seconds 5
  Post 'capture' "$R/smoke/$id-before.png"|Out-Null
  foreach($key in 'KeyW','KeyA','KeyS','KeyD','Enter'){Post 'key' "down $key"|Out-Null;Start-Sleep -Milliseconds 600;Post 'key' "up $key"|Out-Null}
  Post 'key' 'click 0.5 0.5'|Out-Null;Start-Sleep -Seconds 3
  Post 'capture' "$R/smoke/$id-after.png"|Out-Null;$s=Status
  $diff=if((Test-Path "$R/smoke/$id-before.png") -and (Test-Path "$R/smoke/$id-after.png")){ScreenDiff "$R/smoke/$id-before.png" "$R/smoke/$id-after.png"}else{-1}
  $bad=@(Select-String -LiteralPath $log -Pattern 'Fatal error|LogJsgbHost: Error|LogJsgb: Error|: Error: |No cooked material for shader' -ErrorAction SilentlyContinue|Where-Object {$_.Line -notmatch 'socket_send_failure|updateNGXFeature'})
  # Generic keys need not change a static scene; game-specific captureScripts check its views.
  $ok=$diff -ge 0 -and $bad.Count -eq 0 -and $s.jsErrors -eq 0
  "{0} {1}: ready in {2} s, screen change {3}, JS errors {4}, log errors {5}" -f $id,$(if($ok){'PASS'}else{'FAIL'}),$ready,$diff,$s.jsErrors,$bad.Count
 }catch{"$id FAIL: $_"}finally{
  if($process -and !$process.HasExited){Post 'close' ''|Out-Null;if(!$process.WaitForExit(10000)){Stop-Process -Id $process.Id -Force}}
 }
}
