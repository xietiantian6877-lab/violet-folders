using System;
using System.IO;
using System.Threading;
using System.Windows;
using VioletFolders.UI;

namespace VioletFolders;

public partial class App : Application
{
    private Mutex? _instance;
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var capture = Array.Find(e.Args, arg => arg.StartsWith("--capture=", StringComparison.Ordinal));
        var demo = Array.Exists(e.Args, arg => arg == "--demo");
        var silentPreview = demo && capture != null;
        if (!silentPreview)
        {
            _instance = new Mutex(true, "Local\\VioletFolders-Desktop", out var first);
            if (!first) { Shutdown(); return; }
        }
        DispatcherUnhandledException += (_, args) =>
        {
            // An unexpected UI error should never silently terminate the overlay.
            try { Directory.CreateDirectory(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VioletFolders")); File.AppendAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VioletFolders", "error.log"), DateTimeOffset.Now + " " + args.Exception + Environment.NewLine); } catch { }
            MessageBox.Show("紫璃文件夹遇到问题 / Violet Folders encountered a problem.\n" + args.Exception.Message, "Violet Folders", MessageBoxButton.OK, MessageBoxImage.Warning);
            args.Handled = true;
        };
        MainWindow = new OverlayWindow(demo, silentPreview: silentPreview);
        if (silentPreview)
        {
            MainWindow.Opacity = 0; MainWindow.ShowInTaskbar = false;
            ((OverlayWindow)MainWindow).ConfigurePreview(Array.Exists(e.Args, arg => arg == "--english") ? "en" : "zh-CN", Array.Exists(e.Args, arg => arg == "--collapsed"));
        }
        if (capture != null)
        {
            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(silentPreview ? 1 : 2) };
            timer.Tick += async (_, _) =>
            {
                timer.Stop();
                if (silentPreview && Array.Exists(e.Args, arg => arg == "--menu")) await ((OverlayWindow)MainWindow).CaptureMenuPreview(capture[10..]);
                else if (!silentPreview && Array.Exists(e.Args, arg => arg == "--capture-screen")) ((OverlayWindow)MainWindow).CaptureDesktopPreview(capture[10..]);
                else ((OverlayWindow)MainWindow).CapturePreview(capture[10..]);
                if (silentPreview) Shutdown();
            };
            timer.Start();
        }
        MainWindow.Show();
    }
    protected override void OnExit(ExitEventArgs e) { _instance?.Dispose(); base.OnExit(e); }
}
