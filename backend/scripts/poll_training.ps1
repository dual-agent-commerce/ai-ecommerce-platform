# Schedule every 5 minutes. One bounded poll per run; stops when job reaches done/failed/404.
$project = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $project
$python = Join-Path $project 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }
& $python -m backend.scripts.sean_maintenance poll
exit $LASTEXITCODE
