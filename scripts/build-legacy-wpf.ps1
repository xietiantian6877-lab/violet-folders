[CmdletBinding()]
param(
    [ValidateSet('Release', 'Debug')]
    [string]$Configuration = 'Release',
    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64',
    [ValidatePattern('^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$')]
    [string]$Version = '1.0.0',
    [switch]$SkipTests,
    [switch]$IncludeUiTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($SkipTests -and $IncludeUiTests) {
    throw '-SkipTests and -IncludeUiTests cannot be used together.'
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$localDotnet = Join-Path $repoRoot '.tools\dotnet\dotnet.exe'
$dotnet = if (Test-Path -LiteralPath $localDotnet) {
    $localDotnet
} else {
    (Get-Command dotnet -ErrorAction Stop).Source
}

function Invoke-Dotnet {
    param([string[]]$Arguments)
    & $dotnet @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet $($Arguments[0]) failed (exit $LASTEXITCODE)."
    }
}

Push-Location $repoRoot
try {
    $project = Join-Path $repoRoot 'src\VioletFolders\VioletFolders.csproj'
    $tests = Join-Path $repoRoot 'tests\VioletFolders.Tests\VioletFolders.Tests.csproj'
    $uiTests = Join-Path $repoRoot 'tests\VioletFolders.UiTests\VioletFolders.UiTests.csproj'
    $publishDir = Join-Path $repoRoot 'dist\VioletFolders'
    $archivePath = Join-Path $repoRoot "dist\VioletFolders-$Runtime.zip"

    Invoke-Dotnet -Arguments @('build', $project, '-c', $Configuration, "-p:Version=$Version")
    if (-not $SkipTests) {
        Invoke-Dotnet -Arguments @('run', '--project', $tests, '-c', $Configuration)
    }
    if ($IncludeUiTests) {
        if (-not (Test-Path -LiteralPath $uiTests)) {
            throw "UI test project was not found: $uiTests"
        }
        # Requires an interactive Windows desktop with File Explorer available.
        Invoke-Dotnet -Arguments @('run', '--project', $uiTests, '-c', $Configuration)
    }

    # Only this repository's generated publish directory is eligible for cleanup.
    if (Test-Path -LiteralPath $publishDir) {
        $resolvedPublish = (Resolve-Path -LiteralPath $publishDir).ProviderPath.TrimEnd('\')
        $expectedPublish = [IO.Path]::GetFullPath((Join-Path $repoRoot 'dist\VioletFolders')).TrimEnd('\')
        if ($resolvedPublish -ne $expectedPublish) {
            throw "Unexpected publish path: $resolvedPublish"
        }
        Remove-Item -LiteralPath $resolvedPublish -Recurse -Force
    }

    Invoke-Dotnet -Arguments @(
        'publish', $project,
        '-c', $Configuration,
        '-r', $Runtime,
        '--self-contained', 'true',
        '-p:PublishSingleFile=true',
        '-p:IncludeNativeLibrariesForSelfExtract=true',
        '-p:DebugType=None',
        '-p:DebugSymbols=false',
        "-p:Version=$Version",
        '-o', $publishDir
    )
    $executable = Join-Path $publishDir 'VioletFolders.exe'
    if (-not (Test-Path -LiteralPath $executable)) {
        throw "Publish completed without the expected executable: $executable"
    }

    Compress-Archive -Path (Join-Path $publishDir '*') -DestinationPath $archivePath -Force
    $checksum = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
    "$($checksum.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($archivePath))" |
        Set-Content -LiteralPath "$archivePath.sha256" -Encoding ascii

    Write-Output "Executable: $executable"
    Write-Output "Archive:    $archivePath"
    Write-Output "SHA256:     $($checksum.Hash.ToLowerInvariant())"
} finally {
    Pop-Location
}
