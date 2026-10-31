using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using VioletFolders.Domain;

namespace VioletFolders.Services;

public static class FolderLauncher
{
    public static void Open(FolderEntry entry)
    {
        // A monitored handle is safe to reuse while the catalog still reports it open.
        // Navigations update the snapshot on the next poll; validate the HWND before use.
        if (entry.IsOpen && entry.WindowHandle != IntPtr.Zero && IsWindow(entry.WindowHandle))
        {
            if (IsIconic(entry.WindowHandle)) ShowWindow(entry.WindowHandle, 9); // SW_RESTORE
            if (SetForegroundWindow(entry.WindowHandle)) return;
        }

        if (!Directory.Exists(entry.Path)) throw new DirectoryNotFoundException(entry.Path);
        var start = new ProcessStartInfo("explorer.exe") { UseShellExecute = false };
        // ArgumentList performs Windows command-line quoting, including spaces and Unicode.
        start.ArgumentList.Add(entry.Path);
        Process.Start(start)?.Dispose();
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr window);
}
