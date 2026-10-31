param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$OwnerId
)
$ErrorActionPreference = 'Stop'
$full = [IO.Path]::GetFullPath($Path)
$root = [IO.Path]::GetDirectoryName($full)
if ([IO.Path]::GetDirectoryName($root).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($root) -notlike 'VioletFolders-electron-smoke-*') {
    throw 'Only an owned Electron smoke-test folder can be closed.'
}
$ownerGuid = [Guid]::Empty
if (![Guid]::TryParse($OwnerId, [ref]$ownerGuid)) { throw 'A smoke-test ownership UUID is required.' }
$ownerFile = [IO.Path]::Combine($root, '.violet-smoke-owner.json')
if (![IO.File]::Exists($ownerFile)) { throw 'The smoke-test ownership marker is missing.' }
$owner = [IO.File]::ReadAllText($ownerFile) | ConvertFrom-Json
if ($owner.id -cne $OwnerId -or [IO.Path]::GetFullPath([string]$owner.folder).TrimEnd('\') -ine $full.TrimEnd('\')) {
    throw 'The exact folder and ownership UUID must match the current smoke test.'
}
$shell = New-Object -ComObject Shell.Application
$timer = [Diagnostics.Stopwatch]::StartNew()
$emptyScans = 0
$lastCloseError = $null
try {
    # ShellWindows changes asynchronously and Item() can transiently disconnect.
    # A single swallowed COM error used to report success with the folder still
    # open. Re-enumerate and verify absence rather than trusting Quit() alone.
    while ($timer.ElapsedMilliseconds -lt 12000) {
        $windows = $null
        $matching = 0
        $complete = $true
        try {
            $windows = $shell.Windows()
            $count = [int]$windows.Count
            for ($i = $count - 1; $i -ge 0; $i--) {
                $window = $null
                try {
                    $window = $windows.Item($i)
                    if ($null -eq $window) { $complete = $false; continue }
                    if ([IO.Path]::GetFileName([string]$window.FullName) -ine 'explorer.exe') { continue }
                    $uri = $null
                    if ([Uri]::TryCreate([string]$window.LocationURL, [UriKind]::Absolute, [ref]$uri) -and $uri.IsFile -and [IO.Path]::GetFullPath($uri.LocalPath).TrimEnd('\') -ieq $full.TrimEnd('\')) {
                        $matching++
                        $window.Quit()
                    }
                } catch { $complete = $false; $lastCloseError = $_.Exception.Message }
                finally { if ($null -ne $window) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($window) } }
            }
            if ([int]$windows.Count -ne $count) { $complete = $false }
        } catch { $complete = $false; $lastCloseError = $_.Exception.Message }
        finally { if ($null -ne $windows) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($windows) } }
        if ($complete -and $matching -eq 0) { $emptyScans++ } else { $emptyScans = 0 }
        if ($emptyScans -ge 2) { return }
        [Threading.Thread]::Sleep(150)
    }
    throw "The owned Explorer folder did not close within 12 seconds. Last COM error: $lastCloseError"
} finally {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}
