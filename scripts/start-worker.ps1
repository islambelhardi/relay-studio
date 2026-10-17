$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath (Join-Path $projectRoot 'worker')
try {
  uv --cache-dir ..\.uv-cache sync --frozen --python 3.12
  if ($LASTEXITCODE -ne 0) { throw 'Worker dependency setup failed. Install uv and Python 3.12, then retry.' }
  uv --cache-dir ..\.uv-cache run --frozen python -m contentops.main
} finally { Pop-Location }
