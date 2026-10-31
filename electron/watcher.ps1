# Windows PowerShell 5.1, launched in STA by Electron. stdout is JSON-lines only.
# Folder paths are data (JSON + COM BSTR), never executable PowerShell expressions.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

function Send-Message($value) {
    [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 8))
    [Console]::Out.Flush()
}

function Release-Com($value) {
    if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
        try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($value) } catch { }
    }
}

try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;
using System.Threading;
public static class VioletExplorerNative {
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetForegroundWindow(IntPtr hwnd);
}
public static class VioletInput {
    private static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    public static volatile bool Ended;
    public static void Start() {
        var reader = new Thread(() => {
            try { string line; while ((line = Console.In.ReadLine()) != null) Lines.Enqueue(line); }
            finally { Ended = true; }
        });
        reader.IsBackground = true;
        reader.Name = "Violet monitor commands";
        reader.Start();
    }
    public static string Take() { string line; return Lines.TryDequeue(out line) ? line : null; }
}
'@
} catch {
    Send-Message @{ type = 'status'; status = 'error'; error = 'monitor-initialization-failed' }
    exit 1
}

$script:shell = $null
function Get-Shell {
    if ($null -eq $script:shell) { $script:shell = New-Object -ComObject Shell.Application }
    return $script:shell
}

function Get-WindowFolder($window) {
    if ($null -eq $window) { return $null }
    if ([IO.Path]::GetFileName([string]$window.FullName) -ine 'explorer.exe') { return $null }
    $location = [string]$window.LocationURL
    $uri = $null
    if (![Uri]::TryCreate($location, [UriKind]::Absolute, [ref]$uri) -or !$uri.IsFile) { return $null }
    $path = [IO.Path]::GetFullPath($uri.LocalPath)
    return @{ path = $path; windowHandle = ([Int64]$window.HWND).ToString() }
}

function Read-Folders {
    $windows = $null
    try {
        $windows = (Get-Shell).Windows()
        $count = [int]$windows.Count
        $folders = New-Object 'System.Collections.Generic.List[object]'
        $complete = $true
        for ($i = 0; $i -lt $count; $i++) {
            $window = $null
            try {
                $window = $windows.Item($i)
                if ($null -eq $window) { $complete = $false; continue }
                $folder = Get-WindowFolder $window
                if ($null -ne $folder) { $folders.Add($folder) }
            } catch { $complete = $false }
            finally { Release-Com $window }
        }
        # Never remove shortcuts because Explorer disconnected partway through a scan.
        if ($complete -and [int]$windows.Count -eq $count) {
            Send-Message @{ type = 'snapshot'; folders = @($folders.ToArray()) }
        }
    } finally { Release-Com $windows }
}

function Open-Folder($request) {
    $id = [string]$request.id
    $path = [string]$request.path
    if ([string]::IsNullOrWhiteSpace($id) -or $id.Length -gt 80) { return }
    if ([string]::IsNullOrWhiteSpace($path) -or $path.Length -gt 32767 -or $path.IndexOf([char]0) -ge 0) {
        Send-Message @{ type = 'response'; id = $id; ok = $false; error = 'invalid-folder' }
        return
    }
    $windows = $null
    try {
        if (![IO.Directory]::Exists($path)) {
            Send-Message @{ type = 'response'; id = $id; ok = $false; error = 'folder-unavailable' }
            return
        }
        $windows = (Get-Shell).Windows()
        $activated = $false
        for ($i = 0; $i -lt [int]$windows.Count; $i++) {
            $window = $null
            try {
                $window = $windows.Item($i)
                $folder = Get-WindowFolder $window
                if ($null -ne $folder -and $folder.path.TrimEnd('\') -ieq $path.TrimEnd('\')) {
                    $handle = New-Object IntPtr([Int64]$folder.windowHandle)
                    if ([VioletExplorerNative]::IsWindow($handle)) {
                        if ([VioletExplorerNative]::IsIconic($handle)) { [void][VioletExplorerNative]::ShowWindow($handle, 9) }
                        if ([VioletExplorerNative]::SetForegroundWindow($handle)) { $activated = $true; break }
                    }
                }
            } catch { }
            finally { Release-Com $window }
        }
        if (!$activated) { (Get-Shell).Explore($path) }
        Send-Message @{ type = 'response'; id = $id; ok = $true }
    } catch {
        Send-Message @{ type = 'response'; id = $id; ok = $false; error = 'folder-unavailable' }
    } finally { Release-Com $windows }
}

Send-Message @{ type = 'status'; status = 'starting' }
[VioletInput]::Start()
$timer = [Diagnostics.Stopwatch]::StartNew()
$lastScan = -1000
$lastFailure = $false
try {
    while ($true) {
        $line = [VioletInput]::Take()
        if ($null -ne $line) {
            if ($line.Length -gt 0 -and $line.Length -le 40000) {
                try {
                    $request = $line | ConvertFrom-Json
                    if ($request.type -eq 'quit') { break }
                    if ($request.type -eq 'open') { Open-Folder $request }
                } catch { Send-Message @{ type = 'status'; status = 'error'; error = 'invalid-monitor-command' } }
            }
        } elseif ([VioletInput]::Ended) { break }
        if ($timer.ElapsedMilliseconds - $lastScan -ge 650) {
            try { Read-Folders; $lastFailure = $false }
            catch {
                Release-Com $script:shell
                $script:shell = $null
                if (!$lastFailure) { Send-Message @{ type = 'status'; status = 'error'; error = 'explorer-unavailable' } }
                $lastFailure = $true
            }
            $lastScan = $timer.ElapsedMilliseconds
        }
        [Threading.Thread]::Sleep(30)
    }
} finally { Release-Com $script:shell }
