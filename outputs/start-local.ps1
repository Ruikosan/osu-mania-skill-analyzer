$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8765
$url = "http://127.0.0.1:$port"

Set-Location $root

function Test-PortInUse {
  param([int]$Port)
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $connection
}

if (Test-PortInUse -Port $port) {
  Write-Host "Server already appears to be running at $url"
  Write-Host "Open $url in your browser."
  exit 0
}

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($null -eq $pythonCommand) {
  Write-Host "Python was not found on PATH."
  Write-Host "Run this app through any static HTTP server and open $url."
  exit 1
}

Write-Host "Starting osu!mania Skill Analyzer at $url"
Write-Host "Press Ctrl+C to stop the server."
python -m http.server $port --bind 127.0.0.1
