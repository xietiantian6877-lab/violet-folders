using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Markup;
using System.Windows.Threading;
using System.Xml.Linq;
using VioletFolders;
using VioletFolders.Domain;
using VioletFolders.Services;
using VioletFolders.UI;
using Forms = System.Windows.Forms;

internal static class Program
{
    private static int _checks;

    [STAThread]
    private static int Main(string[] args)
    {
        // Inherit production resources, replacing only startup so the test doesn't
        // create a second production instance or acquire its global mutex.
        var app = new TestApplication { NativeOnly = args.Contains("--native-backdrop") };
        var source = XDocument.Load(Path.Combine(AppContext.BaseDirectory, "ProductionApp.xaml"));
        XNamespace presentation = "http://schemas.microsoft.com/winfx/2006/xaml/presentation";
        var resources = source.Root!.Element(presentation + "Application.Resources")!;
        var dictionary = new XElement(presentation + "ResourceDictionary",
            new XAttribute("xmlns", presentation.NamespaceName),
            new XAttribute(XNamespace.Xmlns + "x", "http://schemas.microsoft.com/winfx/2006/xaml"),
            resources.Elements());
        app.Resources = (ResourceDictionary)XamlReader.Parse(dictionary.ToString());
        app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        app.Run();
        return app.Result;
    }

    private sealed class TestApplication : Application
    {
        public int Result { get; private set; } = 1;
        public bool NativeOnly { get; init; }

        protected override async void OnStartup(StartupEventArgs e)
        {
            // Deliberately omit App.OnStartup: the window below is the production UI,
            // but its persistence directory belongs exclusively to this test.
            try { if (NativeOnly) await NativeBackdropSmoke.Run(); else await Program.Run(); Result = 0; }
            catch (Exception ex) { Console.Error.WriteLine("FAIL UI integration: " + ex); }
            finally { Shutdown(); }
        }
    }

    private static async Task Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "VioletFolders-ui-" + Guid.NewGuid().ToString("N"));
        var folder = Path.Combine(root, "folder 中文 空格 %");
        var settingsDirectory = Path.Combine(root, "settings");
        Directory.CreateDirectory(folder);
        OverlayWindow? window = null;
        try
        {
            window = new OverlayWindow(false, settingsDirectory, silentPreview: true) { Opacity = 0, ShowActivated = false };
            window.Show();
            await Until(() => window.IsLoaded, "Production WPF window did not finish loading");
            window.Opacity = 0;
            window.Left = -10000;
            window.UpdateLayout();
            var catalog = Field<FolderCatalog>(window, "_catalog");
            var cards = Field<IDictionary>(window, "_cards");
            var store = Field<SettingsStore>(window, "_store");
            var scroll = Field<ScrollViewer>(window, "_scroll");
            Check(!Field<bool>(window, "_demo") && store.SettingsPath.StartsWith(settingsDirectory) && Field<bool>(Field<ExplorerMonitor>(window, "_monitor"), "_started"), "Real production UI uses isolated settings and live monitoring");

            var close = Buttons(window).Single(button => AutomationProperties.GetName(button).Contains("关闭并退出", StringComparison.Ordinal));
            Check(close.Visibility == Visibility.Visible && close.IsEnabled, "Header exposes a visible, enabled close button");
            Check(window.Topmost && window.AllowsTransparency && window.Background == Brushes.Transparent, "Overlay remains topmost with a transparent shared background");

            FolderLauncher.Open(new FolderEntry(folder));
            await Until(() => catalog.Entries.Any(entry => Same(entry.Path, folder) && entry.IsOpen), "Opened test folder did not appear in the production UI");
            var entry = catalog.Entries.Single(item => Same(item.Path, folder));
            Check(cards.Contains(entry) && Buttons((DependencyObject)cards[entry]!).Any(button => AutomationProperties.GetName(button).Contains(folder, StringComparison.Ordinal)), "Live Explorer snapshot creates its actual clickable UI card");

            await Task.Run(() => CloseOwnedFolder(folder));
            await Until(() => !catalog.Entries.Any(item => Same(item.Path, folder)), "Closed unpinned folder remained in the production UI");
            Check(!cards.Contains(entry), "Closing an unpinned Explorer folder removes its card");

            FolderLauncher.Open(new FolderEntry(folder));
            await Until(() => catalog.Entries.Any(item => Same(item.Path, folder) && item.IsOpen), "Test folder did not reopen");
            entry = catalog.Entries.Single(item => Same(item.Path, folder));
            var pin = Buttons((DependencyObject)cards[entry]!).Single(button => AutomationProperties.GetName(button).StartsWith("常驻：", StringComparison.Ordinal));
            Click(pin);
            Check(entry.IsPinned && store.Load().PinnedPaths.Any(path => Same(path, folder)), "Clicking the real pin button persists the selected folder");

            await Task.Run(() => CloseOwnedFolder(folder));
            await Until(() => !entry.IsOpen, "Pinned folder did not become closed after Explorer exited");
            Check(catalog.Entries.Contains(entry) && cards.Contains(entry), "A pinned card remains after its Explorer window closes");

            var open = Buttons((DependencyObject)cards[entry]!).Single(button => AutomationProperties.GetName(button).Contains(folder, StringComparison.Ordinal));
            Click(open);
            await Until(() => entry.IsOpen, "Clicking the pinned card did not reopen its Explorer folder");
            Check(entry.WindowHandle != IntPtr.Zero, "Clicking a closed pinned card reopens the matching real folder");

            await Task.Run(() => CloseOwnedFolder(folder));
            await Until(() => !entry.IsOpen, "Reopened test folder did not close");
            Click(pin);
            Check(!catalog.Entries.Contains(entry) && !cards.Contains(entry) && !store.Load().PinnedPaths.Any(path => Same(path, folder)), "Unpinning a closed folder removes both its card and persisted pin");

            var fold = Buttons(window).Single(button => AutomationProperties.GetName(button).Contains("折叠 / 展开全部", StringComparison.Ordinal));
            Click(fold);
            Check(scroll.Visibility == Visibility.Collapsed && store.Load().Collapsed, "The real fold button hides all rows and saves its state");
            Click(fold);
            Check(scroll.Visibility == Visibility.Visible && !store.Load().Collapsed, "Unfold restores the folder area");

            var menu = (ContextMenu)window.GetType().GetMethod("CreateMenu", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(window, new object[] { window })!;
            menu.ApplyTemplate();
            menu.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            menu.Arrange(new Rect(menu.DesiredSize));
            Check(menu.Background is SolidColorBrush menuBackground && menuBackground.Color.A == 255 &&
                VisualTreeHelper.GetChild(menu, 0) is Border menuSurface && menuSurface.CornerRadius.TopLeft == 14,
                "Settings menu uses its opaque purple surface and authored rounded template");
            var languageMenu = menu.Items.OfType<MenuItem>().Single(item => Equals(item.Header, "语言 / Language"));
            languageMenu.ApplyTemplate();
            var submenu = (System.Windows.Controls.Primitives.Popup)languageMenu.Template.FindName("PART_Popup", languageMenu);
            Check(submenu.Child is Border submenuSurface && submenuSurface.Background is SolidColorBrush submenuBackground && submenuBackground.Color.A == 255,
                "Language submenu uses the same opaque surface without default system menu chrome");

            var missingPath = Path.Combine(root, "missing pinned folder 中文");
            var missing = new FolderEntry(missingPath);
            catalog.Entries.Add(missing);
            var missingPin = Buttons((DependencyObject)cards[missing]!).Single(button => AutomationProperties.GetName(button).StartsWith("常驻：", StringComparison.Ordinal));
            Click(missingPin);
            var missingOpen = Buttons((DependencyObject)cards[missing]!).Single(button => AutomationProperties.GetName(button).Contains(missingPath, StringComparison.Ordinal));
            Click(missingOpen);
            var notice = Field<TextBlock>(window, "_notice");
            var noticeBorder = Field<Border>(window, "_noticeBorder");
            await Until(() => missingOpen.IsEnabled && noticeBorder.Visibility == Visibility.Visible && notice.Text.Contains("文件夹不可用", StringComparison.Ordinal), "Missing pinned folder did not show its localized recovery notice");
            Check(missing.IsPinned && !missing.IsOpen && cards.Contains(missing) && store.Load().PinnedPaths.Any(path => Same(path, missingPath)), "Unavailable pinned folder shows a Chinese recovery notice and keeps its saved pin");

            var settings = Field<AppSettings>(window, "_settings");
            foreach (var language in new[] { "en", "zh-CN", "en", "zh-CN" })
            {
                settings.Language = language;
                Invoke(window, "BuildSurface");
                window.UpdateLayout();
                var closeName = language == "en" ? "Close and quit Violet Folders" : "关闭并退出紫璃文件夹";
                var localizedClose = Buttons(window).Single(button => AutomationProperties.GetName(button) == closeName);
                Check(localizedClose.Visibility == Visibility.Visible && localizedClose.IsEnabled && Field<TextBlock>(window, "_count").Parent is Panel, $"Repeated {language} rebuild preserves the count label and accessible close button");
                missingOpen = Buttons((DependencyObject)cards[missing]!).Single(button => AutomationProperties.GetName(button).Contains(missingPath, StringComparison.Ordinal));
                Click(missingOpen);
                var message = language == "en" ? "Folder unavailable." : "文件夹不可用";
                await Until(() => missingOpen.IsEnabled && notice.Text.Contains(message, StringComparison.Ordinal), "Recovery notice did not follow the selected language");
            }
            Check(missing.IsPinned && cards.Contains(missing), "Missing-folder recovery stays localized and retains the pin across language changes");

            // Enough retained rows to exceed any normal monitor's usable height.
            var work = WorkArea(window);
            var count = (int)Math.Ceiling(work.Height / 74) + 12;
            for (var index = 0; index < count; index++) catalog.Entries.Add(new FolderEntry(Path.Combine(root, "retained " + index), true));
            window.Left = work.Left + 12;
            window.Top = work.Top + work.Height * .75;
            Invoke(window, "ResizeRows");
            window.UpdateLayout();
            await Task.Delay(350);
            window.UpdateLayout();
            work = WorkArea(window);
            Check(window.Top + window.ActualHeight <= work.Bottom + 1 && scroll.Height < catalog.Entries.Count * 74,
                "A long shelf moved down the screen scrolls entirely inside the monitor work area");

            var tooLow = work.Bottom - 20;
            window.Top = tooLow;
            Invoke(window, "ResizeRows");
            window.UpdateLayout();
            await Task.Delay(100);
            window.UpdateLayout();
            Check(window.Top < tooLow && window.Top + window.ActualHeight <= WorkArea(window).Bottom + 1,
                "A shelf placed against the bottom edge moves up to keep its minimum viewport usable");

            var closed = false;
            window.Closed += (_, _) => closed = true;
            close = Buttons(window).Single(button => AutomationProperties.GetName(button) == "关闭并退出紫璃文件夹");
            Click(close);
            Check(closed && !window.IsVisible && Field<bool>(Field<ExplorerMonitor>(window, "_monitor"), "_disposed"), "The header close button closes the overlay and disposes monitoring");
            window = null;
            Console.WriteLine($"{_checks}/{_checks} production UI integration checks passed.");
        }
        finally
        {
            window?.Close();
            await Task.Run(() => CloseOwnedFolder(folder));
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static bool Same(string first, string second) => string.Equals(first, second, StringComparison.OrdinalIgnoreCase);
    private static void Invoke(object owner, string name) => owner.GetType().GetMethod(name, BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(owner, null);
    private static Rect WorkArea(Window window)
    {
        var source = (HwndSource)PresentationSource.FromVisual(window);
        var area = Forms.Screen.FromHandle(source.Handle).WorkingArea;
        var dpi = VisualTreeHelper.GetDpi(window);
        return new Rect(area.Left / dpi.DpiScaleX, area.Top / dpi.DpiScaleY, area.Width / dpi.DpiScaleX, area.Height / dpi.DpiScaleY);
    }
    private static void Click(Button button) => button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static T Field<T>(object owner, string name) => (T)owner.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(owner)!;
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
        _checks++;
        Console.WriteLine("PASS " + message);
    }

    private static async Task Until(Func<bool> condition, string failure)
    {
        var end = DateTime.UtcNow.AddSeconds(15);
        while (!condition())
        {
            if (DateTime.UtcNow >= end) throw new TimeoutException(failure);
            await Task.Delay(100);
        }
    }

    private static IEnumerable<Button> Buttons(DependencyObject root)
    {
        if (root is Button button) yield return button;
        foreach (var descendant in LogicalTreeHelper.GetChildren(root))
        {
            if (descendant is not DependencyObject dependencyObject) continue;
            foreach (var child in Buttons(dependencyObject)) yield return child;
        }
    }

    private static void CloseOwnedFolder(string ownedPath)
    {
        // Use only a unique test path when closing a window; no user's Explorer window is touched.
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
                        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.IsFile && Same(FolderPath.Normalize(uri.LocalPath) ?? "", ownedPath)) ((dynamic)window).Quit();
                    }
                    catch (COMException) { }
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
        if (!thread.Join(TimeSpan.FromSeconds(15))) throw new TimeoutException("Owned-folder Explorer cleanup timed out.");
        if (failure is not null) throw new InvalidOperationException("Owned-folder Explorer cleanup failed.", failure);
    }
}
