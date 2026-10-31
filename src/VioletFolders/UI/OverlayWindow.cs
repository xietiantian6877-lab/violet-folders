using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using VioletFolders.Domain;
using VioletFolders.Services;
using Forms = System.Windows.Forms;

namespace VioletFolders.UI;

public sealed class OverlayWindow : Window
{
    internal void ConfigurePreview(string language, bool collapsed)
    {
        if (!_demo) return;
        _settings.Language = language;
        _settings.Collapsed = collapsed;
        BuildSurface();
    }
    internal void CapturePreview(string path)
    {
        UpdateLayout();
        var bmp = new System.Windows.Media.Imaging.RenderTargetBitmap((int)Math.Ceiling(ActualWidth), (int)Math.Ceiling(ActualHeight), 96, 96, PixelFormats.Pbgra32);
        bmp.Render(_root);
        var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
        encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bmp));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        using var file = File.Create(path); encoder.Save(file);
        File.WriteAllText(path + ".txt", $"Visible={IsVisible} Position={Left},{Top} Size={ActualWidth},{ActualHeight} Rows={_rows.ActualWidth},{_rows.ActualHeight} Scroll={_scroll.Height} Collapsed={_settings.Collapsed}");
    }
    internal async Task CaptureMenuPreview(string path)
    {
        var menu = CreateMenu(_headerGlass!);
        menu.Opacity = 0;
        menu.IsOpen = true;
        await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Loaded);
        menu.UpdateLayout();
        var visual = (FrameworkElement)VisualTreeHelper.GetChild(menu, 0);
        var bmp = new System.Windows.Media.Imaging.RenderTargetBitmap((int)Math.Ceiling(visual.ActualWidth), (int)Math.Ceiling(visual.ActualHeight), 96, 96, PixelFormats.Pbgra32);
        bmp.Render(visual);
        var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
        encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bmp));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        using (var file = File.Create(path)) encoder.Save(file);
        menu.IsOpen = false;
    }
    internal void CaptureDesktopPreview(string path)
    {
        var corner = PointToScreen(new Point(0, 0));
        var dpi = VisualTreeHelper.GetDpi(this);
        var width = Math.Max(1, (int)Math.Ceiling(ActualWidth * dpi.DpiScaleX));
        var height = Math.Max(1, (int)Math.Ceiling(ActualHeight * dpi.DpiScaleY));
        using var bitmap = new System.Drawing.Bitmap(width, height);
        using (var graphics = System.Drawing.Graphics.FromImage(bitmap)) graphics.CopyFromScreen((int)corner.X, (int)corner.Y, 0, 0, new System.Drawing.Size(width, height));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png);
        File.WriteAllText(path + ".txt", $"NativeAvailable={_nativeGlass?.IsAvailable} ActiveBackdrops={_nativeGlass?.ActiveWindowCount}");
    }
    private readonly SettingsStore _store;
    private readonly AppSettings _settings;
    private readonly FolderCatalog _catalog;
    private readonly ExplorerMonitor _monitor = new();
    private readonly bool _demo;
    private readonly bool _silentPreview;
    private readonly Dictionary<FolderEntry, FrameworkElement> _cards = new();
    private readonly StackPanel _root = new();
    private readonly StackPanel _rows = new();
    private readonly ScrollViewer _scroll;
    private readonly TextBlock _count = Visuals.Text("0", 11, Visuals.Muted);
    private readonly TextBlock _notice = Visuals.Text("", 12);
    private readonly Border _noticeBorder;
    private readonly DispatcherTimer _topmostTimer;
    private readonly DispatcherTimer _noticeTimer;
    private readonly DispatcherTimer _glassTimer;
    private NativeGlassBackdrop? _nativeGlass;
    private Border? _headerGlass;
    private Forms.NotifyIcon? _tray;
    private HwndSource? _source;
    private bool _closing;
    private Button? _collapseButton;

    public OverlayWindow(bool demo, string? settingsDirectory = null, bool silentPreview = false)
    {
        _store = new SettingsStore(settingsDirectory);
        _demo = demo;
        _silentPreview = silentPreview;
        _settings = demo ? new AppSettings() : _store.Load();
        _catalog = new FolderCatalog(_settings.PinnedPaths);
        Title = "Violet Folders · 紫璃文件夹";
        Width = 480;
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = demo;
        ShowActivated = false;
        Topmost = true;
        SizeToContent = SizeToContent.Height;
        FontFamily = new FontFamily("Segoe UI, Microsoft YaHei UI");
        UseLayoutRounding = true;
        TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);
        Left = double.IsFinite(_settings.Left) ? _settings.Left : 12;
        Top = double.IsFinite(_settings.Top) ? _settings.Top : 12;
        Content = _root;
        _scroll = new ScrollViewer { Content = _rows, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Background = null, Padding = new Thickness(0), Height = 0, Focusable = false };
        _noticeBorder = Visuals.Glass(_notice);
        _noticeBorder.Padding = new Thickness(14, 10, 14, 10);
        _noticeBorder.Margin = new Thickness(0, 6, 0, 0);
        _noticeBorder.Visibility = Visibility.Collapsed;
        BuildSurface();
        _catalog.Entries.CollectionChanged += EntriesChanged;
        _catalog.PinsChanged += () => { _settings.PinnedPaths = _catalog.PinnedPaths.ToList(); Save(); UpdateCards(); };
        _monitor.SnapshotAvailable += snapshot => Dispatcher.BeginInvoke(() => { if (!_closing) _catalog.Reconcile(snapshot); });
        _noticeTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
        _noticeTimer.Tick += (_, _) => { _noticeTimer.Stop(); _noticeBorder.Visibility = Visibility.Collapsed; ResizeRows(); };
        _glassTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
        _glassTimer.Tick += (_, _) => SyncBackdrops();
        _topmostTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        _topmostTimer.Tick += (_, _) => { if (_source != null) Native.SetWindowPos(_source.Handle, new IntPtr(-1), 0, 0, 0, 0, 0x13); };
        Loaded += (_, _) =>
        {
            ClampPosition();
            if (!_silentPreview) { SetupTray(); _nativeGlass = new NativeGlassBackdrop(this); _glassTimer.Start(); }
            if (_demo)
            {
                _catalog.Reconcile(new[] { new ExplorerFolder(@"D:\Work\培训集合\店铺授权", IntPtr.Zero), new ExplorerFolder(@"D:\Work\品牌资料\视觉规范", IntPtr.Zero), new ExplorerFolder(@"D:\Projects\Violet Folders", IntPtr.Zero) });
                _catalog.TogglePin(_catalog.Entries[0]);
            }
            else _monitor.Start();
            UpdateCards();
            if (!_silentPreview) _topmostTimer.Start();
        };
        SourceInitialized += (_, _) =>
        {
            _source = (HwndSource)PresentationSource.FromVisual(this);
            _source.AddHook(WindowHook);
            var style = Native.GetWindowLongPtr(_source.Handle, -20).ToInt64();
            if (!_demo) Native.SetWindowLongPtr(_source.Handle, -20, new IntPtr(style | 0x80));
            if (!_silentPreview) Native.RegisterHotKey(_source.Handle, 1, 0x0001 | 0x0002 | 0x4000, 0x46);
        };
        PreviewKeyDown += (_, e) => { if (e.Key == Key.Escape && !_settings.Collapsed) { ToggleCollapse(); e.Handled = true; } };
        Closing += (_, _) =>
        {
            _closing = true;
            _topmostTimer.Stop(); _noticeTimer.Stop(); _glassTimer.Stop(); _nativeGlass?.Dispose();
            _monitor.Dispose();
            if (_source != null) { if (!_silentPreview) Native.UnregisterHotKey(_source.Handle, 1); _source.RemoveHook(WindowHook); }
            _tray?.Dispose(); Save();
        };
    }

    private string T(string zh, string en) => _settings.Language == "en" ? en : zh;
    private void BuildSurface()
    {
        if (_count.Parent is Panel previousHeader) previousHeader.Children.Remove(_count);
        _root.Children.Clear();
        var headerContent = new Grid { Margin = new Thickness(9, 2, 7, 2), Height = 38 };
        headerContent.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerContent.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        headerContent.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        headerContent.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var dragArea = new StackPanel { Orientation = Orientation.Horizontal, Background = Brushes.Transparent, Cursor = Cursors.SizeAll, Margin = new Thickness(3, 0, 9, 0) };
        var logo = Visuals.Icon("logo", 19, Visuals.Accent); logo.Margin = new Thickness(0, 0, 8, 0); dragArea.Children.Add(logo);
        var brand = Visuals.Text(T("紫璃", "VIOLET"), 12); brand.FontWeight = FontWeights.SemiBold; dragArea.Children.Add(brand);
        _count.Margin = new Thickness(10, 0, 1, 0); dragArea.Children.Add(_count);
        dragArea.ToolTip = T("拖动移动 · Ctrl+Alt+F 折叠 / 展开", "Drag to move · Ctrl+Alt+F to fold / unfold");
        dragArea.MouseLeftButtonDown += (_, e) => { if (e.ClickCount == 2) { ToggleCollapse(); return; } try { DragMove(); ClampPosition(true); Save(); } catch (InvalidOperationException) { } };
        headerContent.Children.Add(dragArea);
        _collapseButton = Visuals.Button(_settings.Collapsed ? "down" : "up", T("折叠 / 展开全部", "Fold / unfold all"), ToggleCollapse);
        Grid.SetColumn(_collapseButton, 1); headerContent.Children.Add(_collapseButton);
        Button? menuButton = null;
        menuButton = Visuals.Button("more", T("设置与退出", "Settings and quit"), () => ShowMenu(menuButton!));
        Grid.SetColumn(menuButton, 2); headerContent.Children.Add(menuButton);
        var closeButton = Visuals.Button("close", T("关闭并退出紫璃文件夹", "Close and quit Violet Folders"), Close, 28);
        Grid.SetColumn(closeButton, 3); headerContent.Children.Add(closeButton);
        var header = Visuals.Glass(headerContent, 22);
        _headerGlass = header;
        header.Width = _settings.Language == "en" ? 278 : 248;
        header.HorizontalAlignment = HorizontalAlignment.Left;
        header.Margin = new Thickness(0, 0, 0, 10);
        _root.Children.Add(header);
        _root.Children.Add(_scroll);
        _root.Children.Add(_noticeBorder);
        _cards.Clear(); _rows.Children.Clear();
        UpdateCards();
    }
    private void EntriesChanged(object? sender, NotifyCollectionChangedEventArgs e) => UpdateCards();
    private void UpdateCards()
    {
        foreach (var entry in _cards.Keys.Where(entry => !_catalog.Entries.Contains(entry)).ToArray())
        {
            _rows.Children.Remove(_cards[entry]); _cards.Remove(entry);
        }
        // Remove the first-run hint as soon as an actual folder is seen.
        foreach (var hint in _rows.Children.OfType<FrameworkElement>().Where(x => Equals(x.Tag, "empty")).ToArray()) _rows.Children.Remove(hint);
        foreach (var entry in _catalog.Entries)
        {
            if (_cards.TryGetValue(entry, out var existing))
            {
                if (existing.Tag is RowParts parts) UpdateRow(entry, parts);
                continue;
            }
            var row = MakeRow(entry);
            _cards.Add(entry, row); _rows.Children.Add(row);
            if (SystemParameters.ClientAreaAnimation && !_settings.Collapsed)
            {
                row.BeginAnimation(HeightProperty, new DoubleAnimation(0, 82, TimeSpan.FromMilliseconds(300)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
                row.BeginAnimation(OpacityProperty, new DoubleAnimation(.25, 1, TimeSpan.FromMilliseconds(230)));
                var translate = new TranslateTransform(); row.RenderTransform = translate;
                translate.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(-8, 0, TimeSpan.FromMilliseconds(280)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
            }
        }
        _count.Text = _catalog.Entries.Count.ToString(System.Globalization.CultureInfo.InvariantCulture);
        ResizeRows();
    }
    private void ResizeRows()
    {
        var work = WorkArea();
        var noticeHeight = 0d;
        if (_noticeBorder.Visibility == Visibility.Visible)
        {
            _noticeBorder.Measure(new Size(Width, double.PositiveInfinity));
            noticeHeight = _noticeBorder.DesiredSize.Height;
        }
        const double headerHeight = 54;
        var wantedHeight = _settings.Collapsed ? 0 : _catalog.Entries.Count * 82;
        var minimumViewport = Math.Min(wantedHeight, 82);
        // A moved shelf must scroll within the space below it, including after unfolding.
        var latestTop = Math.Max(work.Top, work.Bottom - headerHeight - noticeHeight - minimumViewport);
        if (Top > latestTop) Top = latestTop;
        var availableHeight = Math.Max(0, work.Bottom - Math.Max(Top, work.Top) - headerHeight - noticeHeight - 6);
        var height = Math.Min(wantedHeight, availableHeight);
        _scroll.BeginAnimation(HeightProperty, null);
        _scroll.Height = height;
        _scroll.Visibility = _settings.Collapsed ? Visibility.Collapsed : Visibility.Visible;
    }
    private FrameworkElement MakeRow(FolderEntry entry)
    {
        var grid = new Grid { Margin = new Thickness(14, 0, 12, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });
        var open = new Button { Style = (Style)FindResource("QuietButton"), HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(5, 0, 3, 0), Height = 60, Margin = new Thickness(0, 5, 0, 5), ToolTip = entry.Path };
        // The path button stretches its content without inheriting the centered icon template.
        var content = new Grid { Width = 374 };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var folderIcon = Visuals.Icon("folder", 21, Visuals.Accent); folderIcon.HorizontalAlignment = HorizontalAlignment.Left; content.Children.Add(folderIcon);
        var pathStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) };
        var name = Visuals.Text(entry.Name, 16, Visuals.Accent); name.FontWeight = FontWeights.SemiBold; name.TextTrimming = TextTrimming.CharacterEllipsis;
        pathStack.Children.Add(name);
        var parent = Visuals.Text(string.IsNullOrEmpty(entry.ParentPath) ? T("磁盘根目录", "Drive root") : entry.ParentPath.TrimEnd('\\'), 11.5, Visuals.Muted); parent.TextTrimming = TextTrimming.CharacterEllipsis; parent.Margin = new Thickness(0, 3, 0, 0);
        pathStack.Children.Add(parent);
        Grid.SetColumn(pathStack, 1); content.Children.Add(pathStack);
        open.Content = content; AutomationProperties.SetName(open, T("打开文件夹 ", "Open folder ") + entry.Path);
        open.Click += async (_, _) =>
        {
            open.IsEnabled = false;
            try { await Task.Run(() => FolderLauncher.Open(entry)); }
            catch (DirectoryNotFoundException) { Notice(T("文件夹不可用，请检查磁盘或网络连接。", "Folder unavailable. Check the drive or network connection.")); }
            catch (Exception ex) { Notice(T("无法打开文件夹：", "Cannot open folder: ") + ex.Message); }
            finally { open.IsEnabled = true; }
        };
        grid.Children.Add(open);
        var pin = Visuals.Button("pin", "", () => _catalog.TogglePin(entry), 40); pin.Height = 44; pin.Padding = new Thickness(4); Grid.SetColumn(pin, 1); grid.Children.Add(pin);
        var glass = Visuals.Glass(grid);
        glass.Height = 72; glass.VerticalAlignment = VerticalAlignment.Top;
        var wrapper = new Grid { Height = 82 }; wrapper.Children.Add(glass);
        var parts = new RowParts(pin, folderIcon, glass);
        wrapper.Tag = parts;
        entry.PropertyChanged += (_, e) => { if (e.PropertyName is nameof(FolderEntry.IsOpen) or nameof(FolderEntry.IsPinned)) UpdateRow(entry, parts); };
        UpdateRow(entry, parts);
        return wrapper;
    }
    private void UpdateRow(FolderEntry entry, RowParts parts)
    {
        var pinContent = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
        var icon = Visuals.Icon(entry.IsPinned ? "pinned" : "pin", 14, entry.IsPinned ? Visuals.Accent : Visuals.Muted);
        pinContent.Children.Add(icon);
        var label = Visuals.Text(entry.IsPinned ? T("常驻", "KEPT") : T("固定", "PIN"), 9, entry.IsPinned ? Visuals.Accent : Visuals.Muted);
        label.HorizontalAlignment = HorizontalAlignment.Center; label.Margin = new Thickness(0, 3, 0, 0); pinContent.Children.Add(label);
        parts.Pin.Content = pinContent;
        parts.Pin.Background = entry.IsPinned ? Visuals.Brush("#30E7CBFF") : Brushes.Transparent;
        var tip = entry.IsPinned ? T("取消常驻：关闭文件夹后移除", "Unpin: remove when the folder closes") : T("常驻：关闭文件夹后仍然保留", "Pin: keep after the folder closes");
        parts.Pin.ToolTip = tip; AutomationProperties.SetName(parts.Pin, tip);
        parts.Icon.Opacity = entry.IsOpen ? 1 : .55;
        parts.Glass.ToolTip = entry.Path + "\n" + (entry.IsOpen ? T("已打开 · 点击切换到文件夹", "Open · Click to switch to folder") : T("已常驻 · 点击重新打开", "Pinned · Click to reopen"));
    }
    private sealed record RowParts(Button Pin, FrameworkElement Icon, Border Glass);

    private void SyncBackdrops()
    {
        if (_nativeGlass == null || _closing) return;
        var surfaces = new List<FrameworkElement>();
        if (_headerGlass != null) surfaces.Add(_headerGlass);
        if (!_settings.Collapsed)
            foreach (var card in _cards.Values) if (card.Tag is RowParts parts) surfaces.Add(parts.Glass);
        if (_noticeBorder.Visibility == Visibility.Visible) surfaces.Add(_noticeBorder);
        _nativeGlass.Update(surfaces);
    }

    private void ToggleCollapse()
    {
        _settings.Collapsed = !_settings.Collapsed;
        if (_collapseButton != null) _collapseButton.Content = Visuals.Icon(_settings.Collapsed ? "down" : "up");
        ResizeRows(); Save();
    }
    private void ShowMenu(FrameworkElement target)
    {
        var menu = CreateMenu(target);
        menu.IsOpen = true;
    }
    private ContextMenu CreateMenu(FrameworkElement target)
    {
        var menu = new ContextMenu { PlacementTarget = _headerGlass ?? target, Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom, VerticalOffset = 6 };
        var title = new MenuItem { Header = T("紫璃文件夹  1.0", "Violet Folders  1.0"), IsEnabled = false }; menu.Items.Add(title);
        var startup = new MenuItem { Header = T("开机启动", "Launch at login"), IsCheckable = true, IsChecked = !_demo && StartupService.IsEnabled };
        startup.Click += (_, _) => { if (_demo) return; try { StartupService.SetEnabled(startup.IsChecked); _settings.LaunchAtLogin = startup.IsChecked; Save(); } catch (Exception ex) { Notice(ex.Message); } }; menu.Items.Add(startup);
        var language = new MenuItem { Header = "语言 / Language" };
        foreach (var pair in new[] { ("zh-CN", "简体中文"), ("en", "English") })
        {
            var item = new MenuItem { Header = pair.Item2, IsCheckable = true, IsChecked = _settings.Language == pair.Item1 };
            item.Click += (_, _) => { _settings.Language = pair.Item1; Save(); BuildSurface(); BuildTrayMenu(); }; language.Items.Add(item);
        }
        menu.Items.Add(language);
        var reset = new MenuItem { Header = T("回到屏幕左上角", "Move to top left") }; reset.Click += (_, _) => { var work = Forms.Screen.PrimaryScreen!.WorkingArea; var dpi = VisualTreeHelper.GetDpi(this); Left = work.Left / dpi.DpiScaleX + 12; Top = work.Top / dpi.DpiScaleY + 10; Save(); }; menu.Items.Add(reset);
        var config = new MenuItem { Header = T("打开配置目录", "Open settings folder") }; config.Click += (_, _) => { try { var dir = Path.GetDirectoryName(_store.SettingsPath)!; Directory.CreateDirectory(dir); Process.Start(new ProcessStartInfo(dir) { UseShellExecute = true }); } catch (Exception ex) { Notice(ex.Message); } }; menu.Items.Add(config);
        menu.Items.Add(new Separator());
        var quit = new MenuItem { Header = T("退出紫璃", "Quit Violet Folders") }; quit.Click += (_, _) => Close(); menu.Items.Add(quit);
        return menu;
    }
    private void SetupTray()
    {
        _tray = new Forms.NotifyIcon { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? System.Drawing.SystemIcons.Application, Text = "Violet Folders · 紫璃文件夹", Visible = true };
        _tray.DoubleClick += (_, _) => Dispatcher.BeginInvoke(() => { if (_settings.Collapsed) ToggleCollapse(); Show(); ClampPosition(); });
        BuildTrayMenu();
    }
    private void BuildTrayMenu()
    {
        if (_tray == null) return;
        var previous = _tray.ContextMenuStrip;
        var menu = new Forms.ContextMenuStrip { BackColor = System.Drawing.Color.FromArgb(30, 20, 43), ForeColor = System.Drawing.Color.FromArgb(245, 238, 255), ShowImageMargin = false };
        menu.Items.Add(T("折叠 / 展开", "Fold / unfold"), null, (_, _) => Dispatcher.BeginInvoke(ToggleCollapse));
        menu.Items.Add(T("回到左上角", "Move to top left"), null, (_, _) => Dispatcher.BeginInvoke(() => { Left = 12; Top = 10; ClampPosition(); Save(); }));
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(T("退出", "Quit"), null, (_, _) => Dispatcher.BeginInvoke(Close));
        _tray.ContextMenuStrip = menu; previous?.Dispose();
    }
    private void Notice(string text)
    {
        _notice.Text = text; _notice.TextWrapping = TextWrapping.Wrap;
        _noticeBorder.Visibility = Visibility.Visible; _noticeTimer.Stop(); _noticeTimer.Start();
        ResizeRows();
    }
    private void Save()
    {
        if (_demo) return;
        _settings.Left = Left; _settings.Top = Top;
        try { _store.Save(_settings); } catch (Exception ex) { Notice(T("配置保存失败：", "Could not save settings: ") + ex.Message); }
    }
    private Rect WorkArea()
    {
        var dpi = VisualTreeHelper.GetDpi(this);
        var screen = _source == null ? Forms.Screen.PrimaryScreen! : Forms.Screen.FromHandle(_source.Handle);
        var work = screen.WorkingArea;
        return new Rect(work.Left / dpi.DpiScaleX, work.Top / dpi.DpiScaleY, work.Width / dpi.DpiScaleX, work.Height / dpi.DpiScaleY);
    }
    private void ClampPosition(bool snap = false)
    {
        var work = WorkArea();
        Left = Math.Clamp(Left, work.Left, Math.Max(work.Left, work.Right - Width));
        Top = Math.Clamp(Top, work.Top, Math.Max(work.Top, work.Bottom - Math.Max(48, ActualHeight)));
        if (snap) { if (Left - work.Left < 22) Left = work.Left + 12; if (Top - work.Top < 22) Top = work.Top + 10; }
        ResizeRows();
    }
    private IntPtr WindowHook(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message == 0x0312 && wParam == new IntPtr(1)) { ToggleCollapse(); handled = true; }
        if (message is 0x007E or 0x02E0) Dispatcher.BeginInvoke(() => ClampPosition());
        return IntPtr.Zero;
    }
}

internal static class Native
{
    [DllImport("user32.dll")] internal static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] internal static extern bool UnregisterHotKey(IntPtr hwnd, int id);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] internal static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] internal static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
}
