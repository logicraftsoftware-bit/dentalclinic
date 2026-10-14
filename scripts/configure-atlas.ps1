$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$localNode = Join-Path $projectRoot '.tools\node-v22.14.0-win-x64\node.exe'
if (Test-Path -LiteralPath $localNode) { $env:PATH = "$(Split-Path -Parent $localNode);$env:PATH" } else { Get-Command node -ErrorAction Stop | Out-Null }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
Write-Host 'This initializes the selected Atlas database and creates a verified platform administrator. Existing account passwords are preserved.'
$secureUri = Read-Host 'Paste the COMPLETE MongoDB URI (input is hidden)' -AsSecureString
$atlasUri = ([System.Net.NetworkCredential]::new('', $secureUri).Password).Trim()
if ($atlasUri -notmatch '^mongodb(?:\+srv)?://') { throw 'Use the complete MongoDB connection URI.' }
$parsedUri = [Uri]$atlasUri
if (-not $parsedUri.AbsolutePath.Trim('/')) {
    # Atlas commonly supplies an empty database path. Preserve credentials and query parameters verbatim.
    $atlasUri = [regex]::Replace($atlasUri, '^(mongodb(?:\+srv)?://[^/?]+)/*(?=\?|$)', '$1/dentalclinic')
    $parsedUri = [Uri]$atlasUri
    Write-Host 'Added /dentalclinic automatically because the copied URL did not specify a database.'
}
Write-Host "Selected database: $($parsedUri.AbsolutePath.Trim('/')) on $($parsedUri.Host)"
$adminEmail = Read-Host 'Super-admin email'
if ($adminEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'Enter a valid administrator email.' }
$securePassword = Read-Host 'New super-admin password (12+ characters, input hidden)' -AsSecureString
$adminPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
if ($adminPassword.Length -lt 12 -or $adminPassword.Length -gt 128) { throw 'Use a password between 12 and 128 characters.' }
$names = @('DATABASE_URL','PLATFORM_ADMIN_EMAIL','PLATFORM_ADMIN_PASSWORD','SEED_DEMO','NODE_ENV')
$previousValues = @{}
foreach ($name in $names) { $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:DATABASE_URL = $atlasUri
    $env:PLATFORM_ADMIN_EMAIL = $adminEmail.ToLowerInvariant()
    $env:PLATFORM_ADMIN_PASSWORD = $adminPassword
    $env:SEED_DEMO = 'false'
    $env:NODE_ENV = 'production'
    & npm.cmd run db:generate
    if ($LASTEXITCODE -ne 0) { throw 'MongoDB client generation failed.' }
    & npm.cmd run db:push
    if ($LASTEXITCODE -ne 0) { throw 'Atlas schema/index setup failed. Check your database user permissions and network access.' }
    & npm.cmd run db:seed
    if ($LASTEXITCODE -ne 0) { throw 'Atlas initialization failed.' }
    Write-Host 'Atlas initialization completed. Use the selected email/password to sign in after deploying. Add APP_URL and BASE_DOMAIN in Vercel, then redeploy. Configure SMTP before clinic signup and private S3 before document uploads.'
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previousValues[$name], 'Process') }
    $atlasUri = $null; $adminPassword = $null; $secureUri.Dispose(); $securePassword.Dispose()
}
