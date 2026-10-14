$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$localNode = Join-Path $projectRoot '.tools\node-v22.14.0-win-x64\node.exe'
if (Test-Path -LiteralPath $localNode) { $nodeExecutable = $localNode; $env:PATH = "$(Split-Path -Parent $localNode);$env:PATH" } else { $nodeExecutable = (Get-Command node -ErrorAction Stop).Source }
$env:NODE_ENV = 'development'
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
$localEnvironment = Get-Content -LiteralPath '.env' -Raw -Encoding UTF8
if ($localEnvironment -notmatch '(?m)^DATABASE_URL=mongodb(?:\+srv)?://') { throw 'Set a MongoDB DATABASE_URL in .env. PostgreSQL is no longer supported.' }
$databaseProcess = $null
try {
    if ($localEnvironment -match '(?m)^DATABASE_URL=mongodb://127\.0\.0\.1:27019/') {
        $probe = New-Object System.Net.Sockets.TcpClient
        $running = $false
        try { $probe.Connect('127.0.0.1', 27019); $running = $true } catch {} finally { $probe.Dispose() }
        if (-not $running) {
            New-Item -ItemType Directory -Path '.tools' -Force | Out-Null
            $databaseScript = Join-Path $projectRoot 'scripts\local-mongo.mjs'
            $databaseProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('"' + $databaseScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.tools\mongo.log') -RedirectStandardError (Join-Path $projectRoot '.tools\mongo-error.log') -PassThru
            $ready = $false
            for ($attempt = 0; $attempt -lt 600; $attempt++) {
                if ($databaseProcess.HasExited) { throw 'Local MongoDB exited. Check .tools/mongo-error.log.' }
                $probe = New-Object System.Net.Sockets.TcpClient
                try { $probe.Connect('127.0.0.1', 27019); $ready = $true; break } catch { Start-Sleep -Seconds 1 } finally { $probe.Dispose() }
            }
            if (-not $ready) { throw 'MongoDB startup timed out. First use downloads a test binary.' }
        }
    }
    & npm.cmd run db:generate
    if ($LASTEXITCODE -ne 0) { throw 'Client generation failed.' }
    & npm.cmd run db:push
    if ($LASTEXITCODE -ne 0) { throw 'MongoDB schema/index setup failed.' }
    & npm.cmd run db:seed
    if ($LASTEXITCODE -ne 0) { throw 'Plan seeding failed.' }
    Write-Host 'Open http://localhost:5173. Keep this terminal open. Ctrl+C stops the application.'
    & npm.cmd run dev
} finally {
    if ($null -ne $databaseProcess -and -not $databaseProcess.HasExited) {
        Set-Content -LiteralPath (Join-Path $projectRoot '.tools\mongo-stop') -Value 'stop'
        if (-not $databaseProcess.WaitForExit(15000)) { Write-Warning 'MongoDB shutdown is still pending. Check the local MongoDB log.' }
    }
}
