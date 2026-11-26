param([switch]$Check, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
if (!(Test-Path $python)) { throw 'Project .venv is missing.' }
$launchArgs = @()
if ($Check) { $launchArgs += '--check' }
if ($NoBrowser) { $launchArgs += '--no-browser' }
& $python (Join-Path $root 'scripts\run_local.py') @launchArgs
exit $LASTEXITCODE
