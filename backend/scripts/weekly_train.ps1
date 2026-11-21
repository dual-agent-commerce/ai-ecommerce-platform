# Schedule this once every week, only after actual sales_history has been imported.
$project = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $project
$python = Join-Path $project 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }
& $python -m backend.scripts.sean_maintenance train
exit $LASTEXITCODE
