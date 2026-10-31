using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using VioletFolders.Domain;

namespace VioletFolders.Services;

/// <summary>Reads Shell automation on a dedicated STA, never on WPF's dispatcher.</summary>
public sealed class ExplorerMonitor : IDisposable
{
    private readonly ManualResetEvent _stop = new(false);
    private readonly Thread _thread;
    private bool _started;
    private bool _disposed;

    public ExplorerMonitor()
    {
        _thread = new Thread(Run) { IsBackground = true, Name = "VioletFolders Explorer monitor" };
        _thread.SetApartmentState(ApartmentState.STA);
    }

    public event Action<IReadOnlyList<ExplorerFolder>>? SnapshotAvailable;

    public void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_started) return;
        _started = true;
        _thread.Start();
    }

    private void Run()
    {
        while (!_stop.WaitOne(0))
        {
            try
            {
                var snapshot = ReadSnapshot();
                if (snapshot is not null && !_stop.WaitOne(0)) SnapshotAvailable?.Invoke(snapshot);
            }
            catch (Exception ex) when (ex is COMException or InvalidComObjectException or System.Reflection.TargetInvocationException or Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
            {
                // Explorer can restart or disconnect automation during navigation. Retry next tick.
            }
            if (_stop.WaitOne(650)) break;
        }
    }

    private static IReadOnlyList<ExplorerFolder>? ReadSnapshot()
    {
        object? shell = null;
        object? windows = null;
        try
        {
            var type = Type.GetTypeFromProgID("Shell.Application");
            if (type is null) return null;
            shell = Activator.CreateInstance(type);
            if (shell is null) return null;
            windows = ((dynamic)shell).Windows();
            var count = (int)((dynamic)windows).Count;
            var result = new List<ExplorerFolder>(count);
            var complete = true;
            for (var i = 0; i < count; i++)
            {
                object? window = null;
                try
                {
                    window = ((dynamic)windows).Item(i);
                    if (window is null) { complete = false; continue; }
                    var fullName = (string)((dynamic)window).FullName;
                    if (!string.Equals(System.IO.Path.GetFileName(fullName), "explorer.exe", StringComparison.OrdinalIgnoreCase)) continue;
                    var url = (string)((dynamic)window).LocationURL;
                    // Shell virtual folders (Home/This PC/Recycle Bin) aren't file-system shortcuts.
                    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || !uri.IsFile) continue;
                    var path = FolderPath.Normalize(uri.LocalPath);
                    if (path is null) continue;
                    var hwnd = new IntPtr(Convert.ToInt64(((dynamic)window).HWND));
                    result.Add(new ExplorerFolder(path, hwnd));
                }
                catch (Exception ex) when (ex is COMException or InvalidComObjectException or System.Reflection.TargetInvocationException or Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
                {
                    // A partial scan must never remove an otherwise open folder from the UI.
                    complete = false;
                }
                finally { Release(window); }
            }
            // A tab/window can appear or disappear halfway through enumeration.
            return complete && (int)((dynamic)windows).Count == count ? result : null;
        }
        finally
        {
            Release(windows);
            Release(shell);
        }
    }

    private static void Release(object? instance)
    {
        if (instance is not null && Marshal.IsComObject(instance)) Marshal.ReleaseComObject(instance);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _stop.Set();
        // Do not block UI shutdown on an out-of-process COM server. The worker is a background thread.
        if (!_started || _thread.Join(100)) _stop.Dispose();
    }
}
