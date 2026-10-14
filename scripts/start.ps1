$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$localNode = Join-Path $projectRoot '.tools\node-v22.14.0-win-x64\node.exe'
if (Test-Path -LiteralPath $localNode) {
    $nodeExecutable = $localNode
    $env:PATH = "$(Split-Path -Parent $localNode);$env:PATH"
} else {
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
}
$env:NODE_ENV = 'development'
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
if (Test-Path -LiteralPath '.env') {
    $localEnvironment = Get-Content -LiteralPath '.env' -Raw -Encoding UTF8
    if ($localEnvironment -match '(?m)^DATABASE_URL=(.+)$' -and $Matches[1] -notmatch '@localhost:54329/dentaflow_utf8') {
        throw 'The current .env targets another database. Use npm run dev for that configuration; this launcher only manages the isolated local database.'
    }
}
$probe = New-Object System.Net.Sockets.TcpClient
$databaseRunning = $false
try { $probe.Connect('127.0.0.1', 54329); $databaseRunning = $true } catch {} finally { $probe.Dispose() }
$databaseProcess = $null
try {
    if (-not $databaseRunning) {
        New-Item -ItemType Directory -Path '.tools' -Force | Out-Null
        $databaseScript = Join-Path $projectRoot 'scripts\local-db.mjs'
        $databaseProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('"' + $databaseScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.tools\database.log') -RedirectStandardError (Join-Path $projectRoot '.tools\database-error.log') -PassThru
        $databaseReady = $false
        for ($attempt = 0; $attempt -lt 90; $attempt++) {
            if ($databaseProcess.HasExited) { throw 'Local PostgreSQL exited. Check .tools/database-error.log.' }
            $probe = New-Object System.Net.Sockets.TcpClient
            try { $probe.Connect('127.0.0.1', 54329); $databaseReady = $true; break } catch { Start-Sleep -Seconds 1 } finally { $probe.Dispose() }
        }
        if (-not $databaseReady) { throw 'PostgreSQL startup timed out. Check .tools/database.log.' }
    }
    & $nodeExecutable 'scripts/setup-local.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Local database setup failed.' }
    & npm.cmd run db:seed
    if ($LASTEXITCODE -ne 0) { throw 'Plan seeding failed.' }
    Write-Host 'Open http://localhost:5173 and choose Start Free Trial. Keep this terminal open. Ctrl+C stops the application.'
    & npm.cmd run dev
} finally {
    if ($null -ne $databaseProcess) {
        $databaseDirectory = (Resolve-Path -LiteralPath (Join-Path $projectRoot '.local-db') -ErrorAction SilentlyContinue).Path
        if ($databaseDirectory -and $databaseDirectory.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
            $control = Join-Path $projectRoot 'node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe'
            if (Test-Path -LiteralPath $control) { & $control -D $databaseDirectory stop -m fast -w }
        }
        Stop-Process -Id $databaseProcess.Id -ErrorAction SilentlyContinue
    }
}
