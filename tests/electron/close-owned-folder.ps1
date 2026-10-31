param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$full = [IO.Path]::GetFullPath($Path)
$root = [IO.Path]::GetDirectoryName($full)
if ([IO.Path]::GetDirectoryName($root).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($root) -notlike 'VioletFolders-electron-smoke-*') {
    throw 'Only an owned Electron smoke-test folder can be closed.'
}
$shell = New-Object -ComObject Shell.Application
$windows = $null
try {
    $windows = $shell.Windows()
    for ($i = [int]$windows.Count - 1; $i -ge 0; $i--) {
        $window = $null
        try {
            $window = $windows.Item($i)
            $uri = $null
            if ([Uri]::TryCreate([string]$window.LocationURL, [UriKind]::Absolute, [ref]$uri) -and $uri.IsFile -and [IO.Path]::GetFullPath($uri.LocalPath).TrimEnd('\') -ieq $full.TrimEnd('\')) { $window.Quit() }
        } catch { }
        finally { if ($null -ne $window) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($window) } }
    }
} finally {
    if ($null -ne $windows) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($windows) }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}
