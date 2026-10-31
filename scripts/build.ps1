[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction Stop
}
$npm = $npmCommand.Source
$nodeVersion = (& $node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') {
    throw 'Could not determine the installed Node.js version.'
}
if ([int]$Matches[1] -lt 22) {
    throw "Node.js 22 or newer is required. Installed version: $nodeVersion"
}

function Invoke-Npm {
    param([string[]]$Arguments)
    & $npm @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments -join ' ') failed (exit $LASTEXITCODE)."
    }
}

Push-Location $repoRoot
try {
    if (-not $SkipInstall) {
        $installCommand = if (Test-Path -LiteralPath 'package-lock.json') { 'ci' } else { 'install' }
        Invoke-Npm -Arguments @($installCommand)
    }
    if (-not $SkipTests) {
        Invoke-Npm -Arguments @('test')
    }
    # The primary Electron dist script checks TypeScript, builds Vite, packages
    # portable Windows x64 EXE/ZIP files, and generates SHA-256 checksums.
    Invoke-Npm -Arguments @('run', 'dist')
    Write-Output "Portable packages and checksums: $(Join-Path $repoRoot 'release')"
} finally {
    Pop-Location
}
