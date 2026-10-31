using System.Runtime.InteropServices;
using VioletFolders.Domain;
using VioletFolders.Services;

/// <summary>Explicit, opt-in integration check. Opens and closes only a uniquely owned test folder.</summary>
internal static class ExplorerSmoke
{
    public static int Run()
    {
        var path = Path.Combine(Path.GetTempPath(), "VioletFolders-smoke-" + Guid.NewGuid().ToString("N"), "中文 folder %");
        Directory.CreateDirectory(path);
        using var monitor = new ExplorerMonitor();
        using var changed = new AutoResetEvent(false);
        IReadOnlyList<ExplorerFolder> latest = [];
        var gate = new object();
        monitor.SnapshotAvailable += snapshot =>
        {
            lock (gate) latest = snapshot;
            changed.Set();
        };
        bool HasFolder()
        {
            lock (gate) return latest.Any(folder => string.Equals(folder.Path, path, StringComparison.OrdinalIgnoreCase));
        }
        bool WaitFor(bool expected)
        {
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (DateTime.UtcNow < deadline)
            {
                if (HasFolder() == expected) return true;
                changed.WaitOne(1000);
            }
            return false;
        }
        try
        {
            monitor.Start();
            FolderLauncher.Open(new FolderEntry(path));
            if (!WaitFor(true)) throw new InvalidOperationException("Explorer's unique test folder was not detected within 15s.");
            Console.WriteLine("PASS COM monitor detects a live Unicode / space / percent folder.");
            ExplorerFolder detected;
            lock (gate) detected = latest.First(folder => string.Equals(folder.Path, path, StringComparison.OrdinalIgnoreCase));
            if (detected.WindowHandle == IntPtr.Zero) throw new InvalidOperationException("Expected a nonzero Explorer window handle.");
            CloseOwnedFolder(path);
            if (!WaitFor(false)) throw new InvalidOperationException("Closed test folder remained in the snapshot for 15s.");
            Console.WriteLine("PASS COM monitor removes the folder after its Explorer window closes.");
            Console.WriteLine("2/2 integration checks passed.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("FAIL Explorer smoke: " + ex);
            return 1;
        }
        finally
        {
            CloseOwnedFolder(path);
            monitor.Dispose();
            var root = Directory.GetParent(path)!.FullName;
            Directory.Delete(root, recursive: true);
        }
    }

    private static void CloseOwnedFolder(string ownedPath)
    {
        // Shell automation is apartment-affine; keep enumeration and release on one STA.
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            object? shell = null;
            object? windows = null;
            try
            {
                shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application")!);
                windows = ((dynamic)shell!).Windows();
                for (var i = (int)((dynamic)windows).Count - 1; i >= 0; i--)
                {
                    object? window = null;
                    try
                    {
                        window = ((dynamic)windows).Item(i);
                        var url = (string)((dynamic)window!).LocationURL;
                        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.IsFile && string.Equals(FolderPath.Normalize(uri.LocalPath), ownedPath, StringComparison.OrdinalIgnoreCase))
                        {
                            ((dynamic)window).Quit();
                        }
                    }
                    catch (COMException) { /* A window can finish closing during the cleanup scan. */ }
                    finally { if (window is not null && Marshal.IsComObject(window)) Marshal.ReleaseComObject(window); }
                }
            }
            catch (Exception ex) { failure = ex; }
            finally
            {
                if (windows is not null && Marshal.IsComObject(windows)) Marshal.ReleaseComObject(windows);
                if (shell is not null && Marshal.IsComObject(shell)) Marshal.ReleaseComObject(shell);
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (failure is not null) Console.Error.WriteLine("Owned folder cleanup: " + failure.Message);
    }
}
