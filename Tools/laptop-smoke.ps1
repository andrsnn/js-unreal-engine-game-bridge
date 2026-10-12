# Smoke test on the PC that received the play package: starts each game through its launcher (the desktop
# shortcuts point at the same .cmd files), waits until the game is ready, takes a screenshot, presses W A S D and
# Enter (which starts a new game from a title menu) and clicks, takes a second screenshot, checks the screen changed and the log has no Fatal or Error lines, then closes
# the game. One line per game; the screenshots land in smoke\.
#   powershell -File smoke.ps1 -Games "hardburn=Hard Burn;unlit=Unlit Worlds;saltblade=Saltblade"
param([string]$Games)
$ErrorActionPreference = 'Continue'; $ProgressPreference = 'SilentlyContinue'
$R = Split-Path -Parent $MyInvocation.MyCommand.Path
$Host_ = 'http://127.0.0.1:5292/bridge'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force "$R\smoke" | Out-Null
function Post($route, $body) { try { Invoke-RestMethod -Method Post -TimeoutSec 10 -Body $body "$Host_/$route" } catch { $null } }
function Status { try { Invoke-RestMethod -TimeoutSec 3 "$Host_/status" } catch { $null } }
# Mean difference of two screenshots over a grid of sample points, 0 to 255.
function ScreenDiff($a, $b) {
  $x = [System.Drawing.Bitmap]::FromFile($a); $y = [System.Drawing.Bitmap]::FromFile($b); $sum = 0; $n = 0
  for ($i = 1; $i -lt 40; $i++) { for ($j = 1; $j -lt 40; $j++) {
    $p = $x.GetPixel([int]($x.Width * $i / 40), [int]($x.Height * $j / 40)); $q = $y.GetPixel([int]($y.Width * $i / 40), [int]($y.Height * $j / 40))
    $sum += ([math]::Abs($p.R - $q.R) + [math]::Abs($p.G - $q.G) + [math]::Abs($p.B - $q.B)) / 3; $n++ } }
  $x.Dispose(); $y.Dispose(); [math]::Round($sum / $n, 1)
}
foreach ($pair in $Games.Split(';')) {
  $id, $name = $pair.Split('=')
  Get-Process JsgbHost -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
  $log = "$R\host\Windows\JsgbHost\Saved\Logs\jsgb-$id.log"
  Remove-Item $log -ErrorAction SilentlyContinue
  # A scheduled task with /IT runs in the signed-in desktop session, so the game window is on screen.
  Set-Content -Encoding ascii "$R\smoke\run.cmd" "call `"$R\Play $name.cmd`" -JsgbAllowRemote -JsgbMaxSeconds=240 -logPSO"
  schtasks /Create /F /TN JsgbSmoke /SC ONCE /ST 23:59 /TR "$R\smoke\run.cmd" /IT | Out-Null
  schtasks /Run /TN JsgbSmoke | Out-Null
  $t0 = Get-Date; $s = $null
  while (((Get-Date) - $t0).TotalSeconds -lt 180) { Start-Sleep 2; $s = Status; if ($s -and $s.ready) { break } }
  $ready = [int]((Get-Date) - $t0).TotalSeconds
  if (-not ($s -and $s.ready)) { "$id FAIL: not ready after $ready s (host answering: $([bool]$s))" }
  else {
    Start-Sleep 5
    Post 'capture' "$R\smoke\$id-before.png" | Out-Null; Start-Sleep 2
    foreach ($k in 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Enter') { Post 'key' "down $k" | Out-Null; Start-Sleep -Milliseconds 600; Post 'key' "up $k" | Out-Null }
    Post 'key' 'click 0.5 0.5' | Out-Null; Start-Sleep 2
    Post 'capture' "$R\smoke\$id-after.png" | Out-Null; Start-Sleep 3
    $s = Status
    $diff = if ((Test-Path "$R\smoke\$id-before.png") -and (Test-Path "$R\smoke\$id-after.png")) { ScreenDiff "$R\smoke\$id-before.png" "$R\smoke\$id-after.png" } else { -1 }
    $bad = @(Select-String -Path $log -Pattern 'Fatal error|LogJsgbHost: Error|LogJsgb: Error|: Error: |No cooked material for shader' -ErrorAction SilentlyContinue | Where-Object { $_.Line -notmatch 'socket_send_failure|updateNGXFeature' })
    $ok = $diff -gt 0.5 -and $bad.Count -eq 0 -and $s.jsErrors -eq 0
    "{0} {1}: ready in {2} s, screen changed by {3} after W A S D, Enter and a click, {4} FPS, JS errors {5}, log errors {6}{7}" -f $id, $(if ($ok) { 'PASS' } else { 'FAIL' }), $ready, $diff, [int]$s.fps, $s.jsErrors, $bad.Count, $(if ($bad.Count) { ': ' + $bad[0].Line.Substring(0, [math]::Min(200, $bad[0].Line.Length)) } else { '' })
  }
  Post 'close' '' | Out-Null
  for ($i = 0; $i -lt 30 -and (Get-Process JsgbHost -ErrorAction SilentlyContinue); $i++) { Start-Sleep 1 }
}
schtasks /Delete /F /TN JsgbSmoke | Out-Null
