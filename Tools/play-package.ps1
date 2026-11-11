# Plays a packaged game full screen behind a small window that says what is happening from the first second. If a file
# names a newer commit of the game than the package holds (-Stable <file>, its first word), the package's copy of the game
# is rebuilt from that commit first (Tools/laptop-package.mjs without --host: the game's bundle and files, no cooking).
#   powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File Tools\play-package.ps1 -Package H:\builds\HardBurnUnreal-play -Game hardburn -Title "Hard Burn" [-Stable <file>] [-Windowed]
param([string]$Package, [string]$Game = 'hardburn', [string]$Title = 'Hard Burn', [string]$Stable = '', [switch]$Windowed, [string]$Extra = '', [string]$Hint = 'Press F9 in the game to turn Lumen and the high-detail models on or off.')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bridge = Split-Path $PSScriptRoot -Parent
$log = Join-Path $Package "host\Windows\JsgbHost\Saved\Logs\jsgb-$($Game).log"
$out = Join-Path $env:TEMP "jsgb-package-$($Game).txt"
$times = Join-Path $env:TEMP "jsgb-launch-$($Game).txt"
Remove-Item $log, $out, $times -ErrorAction SilentlyContinue
# When each stage happened, for timing a launch (Tools read this file).
function Mark($what) { Add-Content -Path $times -Value "$what $([DateTimeOffset]::Now.ToUnixTimeMilliseconds())" }
Mark 'script'

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'; $form.StartPosition = 'CenterScreen'; $form.Size = New-Object System.Drawing.Size(560, 196)
$form.BackColor = [System.Drawing.Color]::FromArgb(14, 16, 20); $form.TopMost = $true; $form.Text = "$Title (Unreal)"
$name = New-Object System.Windows.Forms.Label
$name.Text = $Title.ToUpper(); $name.ForeColor = [System.Drawing.Color]::White; $name.Font = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
$name.AutoSize = $true; $name.Location = New-Object System.Drawing.Point(28, 22)
$step = New-Object System.Windows.Forms.Label
$step.ForeColor = [System.Drawing.Color]::FromArgb(185, 198, 216); $step.Font = New-Object System.Drawing.Font('Segoe UI', 11)
$step.AutoSize = $true; $step.Location = New-Object System.Drawing.Point(30, 78); $step.Text = 'Starting'
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(30, 116); $bar.Size = New-Object System.Drawing.Size(500, 14); $bar.Minimum = 0; $bar.Maximum = 100; $bar.Style = 'Continuous'
$tip = New-Object System.Windows.Forms.Label
$tip.ForeColor = [System.Drawing.Color]::FromArgb(140, 152, 170); $tip.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$tip.AutoSize = $true; $tip.Location = New-Object System.Drawing.Point(30, 146); $tip.Text = $Hint
$form.Controls.AddRange(@($name, $step, $bar, $tip))

# The commit the package holds, and the one asked for.
$held = ''; $publication = Join-Path $Package "games\$Game\publication.json"
if (Test-Path $publication) { $held = (Get-Content $publication -Raw | ConvertFrom-Json).sourceCommit }
$wanted = ''
if ($Stable -and (Test-Path $Stable)) { $m = [regex]::Match((Get-Content $Stable -Raw), '\b[0-9a-f]{7,40}\b'); if ($m.Success) { $wanted = $m.Value } }
$update = $null
if ($wanted -and -not ($held -and $held.StartsWith($wanted.Substring(0, [Math]::Min(7, $wanted.Length))))) {
  $update = Start-Process -FilePath 'node.exe' -ArgumentList "`"$(Join-Path $bridge 'Tools\laptop-package.mjs')`" --games $Game --pin $Game=$wanted --no-smoke --out `"$Package`"" -WorkingDirectory $bridge -WindowStyle Hidden -RedirectStandardOutput $out -PassThru
}
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$script:hostProcess = $null; $script:phase = 0; $started = Get-Date
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
  $seconds = ((Get-Date) - $started).TotalSeconds
  if ($script:phase -eq 0) {
    if ($update -and -not $update.HasExited) { $step.Text = 'Getting the latest version of the game'; $bar.Value = [Math]::Min(30, 3 + [int]($seconds / 2)); return }
    $mode = if ($Windowed) { '-windowed' } else { '-fullscreen' }
    $arguments = "`"-JsgbGame=$(Join-Path $Package "games\$Game")`" $mode -ResX=$($screen.Width) -ResY=$($screen.Height) -JsgbDlssKeys -JsgbJitter -JsgbJsThread -log=jsgb-$($Game).log $Extra"
    $script:hostProcess = Start-Process -FilePath (Join-Path $Package 'host\Windows\JsgbHost.exe') -ArgumentList $arguments -WorkingDirectory $Package -PassThru
    $script:phase = 1; $script:launched = Get-Date; Mark 'unreal'
    return
  }
  $since = ((Get-Date) - $script:launched).TotalSeconds
  $step.Text = 'Starting Unreal Engine'; $bar.Value = [Math]::Min(97, 35 + [int]($since * 4))
  $up = (Test-Path $log) -and (Select-String -Path $log -Pattern 'LogJsgbHost: Display: Game ' -Quiet -ErrorAction SilentlyContinue)
  if ($up -or $since -gt 180) { Mark 'window'; $timer.Stop(); $form.Close() }
})
$form.Add_Shown({ Mark 'shown' })
$timer.Start()
[void]$form.ShowDialog()
