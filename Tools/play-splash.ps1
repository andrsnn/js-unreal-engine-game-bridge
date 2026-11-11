# Starts a game in the live host project (Tools/play-live.mjs) behind a small window that says what is happening from
# the first second, and closes it when the game's own loading screen is up.
#   powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File Tools\play-splash.ps1 -Game hardburn -Title "Hard Burn" [-Stable <file>] [-Extra "<play-live arguments>"]
param([string]$Game = 'hardburn', [string]$Title = 'Hard Burn', [string]$Stable = '', [string]$Extra = '')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bridge = Split-Path $PSScriptRoot -Parent
$settings = Get-Content (Join-Path $bridge 'jsgb.local.json') -Raw | ConvertFrom-Json
$log = Join-Path (Split-Path $settings.project -Parent) "Saved\Logs\jsgb-$Game-play.log"
$out = Join-Path $env:TEMP "jsgb-play-$Game.txt"
Remove-Item $log, $out -ErrorAction SilentlyContinue

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'; $form.StartPosition = 'CenterScreen'; $form.Size = New-Object System.Drawing.Size(560, 170)
$form.BackColor = [System.Drawing.Color]::FromArgb(14, 16, 20); $form.TopMost = $true; $form.ShowInTaskbar = $true; $form.Text = "$Title (Unreal)"
$name = New-Object System.Windows.Forms.Label
$name.Text = $Title.ToUpper(); $name.ForeColor = [System.Drawing.Color]::White; $name.Font = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
$name.AutoSize = $true; $name.Location = New-Object System.Drawing.Point(28, 22)
$step = New-Object System.Windows.Forms.Label
$step.ForeColor = [System.Drawing.Color]::FromArgb(185, 198, 216); $step.Font = New-Object System.Drawing.Font('Segoe UI', 11)
$step.AutoSize = $true; $step.Location = New-Object System.Drawing.Point(30, 78); $step.Text = 'Building the game'
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(30, 116); $bar.Size = New-Object System.Drawing.Size(500, 14); $bar.Minimum = 0; $bar.Maximum = 100; $bar.Style = 'Continuous'
$form.Controls.AddRange(@($name, $step, $bar))

$arguments = "`"$(Join-Path $bridge 'Tools\play-live.mjs')`" $Game"
if ($Stable) { $arguments += " --stable `"$Stable`"" }
if ($Extra) { $arguments += " $Extra" }
$node = Start-Process -FilePath 'node.exe' -ArgumentList $arguments -WorkingDirectory $bridge -WindowStyle Hidden -RedirectStandardOutput $out -PassThru
$started = Get-Date
# About how long each step takes on this PC: the bundle 5 s, Unreal's start 20 s, the game's own loading screen after that.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
  $seconds = ((Get-Date) - $started).TotalSeconds
  $text = if (Test-Path $out) { Get-Content $out -Raw -ErrorAction SilentlyContinue } else { '' }
  $host_ = if (Test-Path $log) { Select-String -Path $log -Pattern 'LogJsgbHost: Display: Game ' -Quiet -ErrorAction SilentlyContinue } else { $false }
  if ($host_) { $timer.Stop(); $form.Close(); return }
  if (Test-Path $log) { $step.Text = 'Starting Unreal Engine'; $bar.Value = [Math]::Min(96, 30 + [int](($seconds - 6) * 3.2)) }
  elseif ($text -match 'started ') { $step.Text = 'Starting Unreal Engine'; $bar.Value = [Math]::Min(40, 25 + [int]$seconds) }
  elseif ($text -match 'exporting') { $step.Text = 'Getting the latest version of the game'; $bar.Value = [Math]::Min(20, 5 + [int]$seconds) }
  else { $step.Text = 'Building the game'; $bar.Value = [Math]::Min(22, 4 + [int]($seconds * 4)) }
  if ($node.HasExited -and $node.ExitCode -ne 0) { $timer.Stop(); $step.Text = 'The game could not start. See ' + $out; $bar.Value = 0; $close = New-Object System.Windows.Forms.Timer; $close.Interval = 15000; $close.Add_Tick({ $form.Close() }); $close.Start() }
  if ($seconds -gt 240) { $timer.Stop(); $form.Close() }
})
$timer.Start()
[void]$form.ShowDialog()
