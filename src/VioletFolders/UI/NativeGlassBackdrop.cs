using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Win32;

namespace VioletFolders.UI;

/// <summary>
/// Places a separate, rounded native acrylic window behind each glass surface.
/// Only the supplied surfaces receive a backdrop; the spaces between them remain
/// actual desktop pixels. All native windows are disabled and refuse activation.
/// </summary>
/// <remarks>
/// Call Update on the owner's dispatcher after layout, and while moving/animating.
/// SetWindowCompositionAttribute is a best-effort Windows accent capability: if it
/// is unavailable, or Windows transparency/high contrast settings prohibit it,
/// the normal WPF glass treatment remains usable without a native backdrop.
/// </remarks>
public sealed class NativeGlassBackdrop : IDisposable
{
    private const string ClassName = "VioletFolders.NativeGlassBackdrop.v1";
    private static readonly object RegistrationLock = new();
    private static readonly WindowProcedure Procedure = WindowProc;
    private static bool _registered;
    private readonly Window _owner;
    private readonly Dictionary<FrameworkElement, Backdrop> _backdrops = new();
    private FrameworkElement[] _surfaces = Array.Empty<FrameworkElement>();
    private bool _available;
    private bool _disposed;
    private bool _updating;

    public NativeGlassBackdrop(Window owner)
    {
        _owner = owner ?? throw new ArgumentNullException(nameof(owner));
        _owner.VerifyAccess();
        _available = OperatingSystem.IsWindowsVersionAtLeast(10) && TransparencyEnabled();
        _owner.LocationChanged += OwnerMoved;
        _owner.SizeChanged += OwnerResized;
        _owner.IsVisibleChanged += OwnerVisibilityChanged;
        _owner.StateChanged += OwnerMoved;
        _owner.Closed += OwnerClosed;
    }

    public bool IsAvailable => _available && !_disposed;
    public int ActiveWindowCount => _backdrops.Values.Count(backdrop => backdrop.Visible);

    public void Update(IEnumerable<FrameworkElement> surfaces)
    {
        _owner.VerifyAccess();
        if (_disposed || _updating) return;
        ArgumentNullException.ThrowIfNull(surfaces);
        _surfaces = surfaces.Where(surface => surface is not null).Distinct().ToArray();
        Refresh();
    }

    private void Refresh()
    {
        if (_disposed || _updating) return;
        _updating = true;
        try
        {
            var retained = new HashSet<FrameworkElement>(_surfaces);
            foreach (var surface in _backdrops.Keys.Where(surface => !retained.Contains(surface)).ToArray())
            {
                Destroy(_backdrops[surface]);
                _backdrops.Remove(surface);
            }

            var ownerHandle = new WindowInteropHelper(_owner).Handle;
            if (!_available || ownerHandle == IntPtr.Zero || !_owner.IsVisible || _owner.Opacity <= 0 ||
                _owner.WindowState == WindowState.Minimized || SystemParameters.HighContrast)
            {
                HideAll();
                return;
            }

            // These popups intentionally have no native owner. Windows forces an
            // owned popup above its owner, which would cover WPF's controls.
            var previous = ownerHandle;
            foreach (var surface in _surfaces)
            {
                if (!TryGetGeometry(surface, out var geometry))
                {
                    if (_backdrops.TryGetValue(surface, out var hidden)) Hide(hidden);
                    continue;
                }

                if (!_backdrops.TryGetValue(surface, out var backdrop))
                {
                    backdrop = CreateBackdrop();
                    if (backdrop is null) { HideAll(); return; }
                    _backdrops.Add(surface, backdrop);
                }

                if (backdrop.Geometry != geometry)
                {
                    if (!SetRegion(backdrop.Handle, geometry)) { Hide(backdrop); continue; }
                }

                var needsPosition = !backdrop.Visible || backdrop.Geometry != geometry || GetWindow(backdrop.Handle, 3) != previous; // GW_HWNDPREV
                if (needsPosition)
                {
                    if (!SetWindowPos(backdrop.Handle, previous, geometry.Left, geometry.Top, geometry.Width, geometry.Height,
                        0x0010 | 0x0040 | 0x0200)) // NOACTIVATE | SHOWWINDOW | NOOWNERZORDER
                    {
                        Hide(backdrop);
                        continue;
                    }
                    backdrop.Geometry = geometry;
                    backdrop.Visible = true;
                }
                previous = backdrop.Handle;
            }
        }
        finally { _updating = false; }
    }

    private Backdrop? CreateBackdrop()
    {
        var handle = IntPtr.Zero;
        try
        {
            EnsureRegistered();
            const uint extended = 0x08000000 | 0x00000080 | 0x00000020 | 0x00000008; // NOACTIVATE | TOOLWINDOW | TRANSPARENT | TOPMOST
            const uint style = 0x80000000 | 0x08000000; // POPUP | DISABLED: never receives mouse/keyboard input
            handle = CreateWindowEx(extended, ClassName, string.Empty, style, 0, 0, 1, 1, IntPtr.Zero, IntPtr.Zero, GetModuleHandle(null), IntPtr.Zero);
            if (handle == IntPtr.Zero) { _available = false; return null; }
            // GradientColor uses ABGR, not ARGB. A translucent desaturated violet
            // tint lets the desktop's real acrylic blur carry the material.
            if (!ApplyAccent(handle, 4, 0x553F2937) && !ApplyAccent(handle, 3, 0x553F2937))
            {
                DestroyWindow(handle);
                _available = false;
                return null;
            }
            return new Backdrop(handle);
        }
        catch (Exception ex) when (ex is EntryPointNotFoundException or DllNotFoundException or Win32Exception)
        {
            if (handle != IntPtr.Zero) DestroyWindow(handle);
            _available = false;
            return null;
        }
    }

    private static bool ApplyAccent(IntPtr window, int state, uint tint)
    {
        var policy = new AccentPolicy { State = state, Flags = 2, GradientColor = tint };
        var memory = Marshal.AllocHGlobal(Marshal.SizeOf<AccentPolicy>());
        try
        {
            Marshal.StructureToPtr(policy, memory, false);
            var data = new CompositionData { Attribute = 19, Data = memory, Size = (nuint)Marshal.SizeOf<AccentPolicy>() };
            return SetWindowCompositionAttribute(window, ref data);
        }
        finally { Marshal.FreeHGlobal(memory); }
    }

    private bool TryGetGeometry(FrameworkElement surface, out SurfaceGeometry geometry)
    {
        geometry = default;
        if (!surface.IsVisible || surface.Opacity <= 0 || surface.ActualWidth < 1 || surface.ActualHeight < 1 ||
            PresentationSource.FromVisual(surface) != PresentationSource.FromVisual(_owner)) return false;
        try
        {
            var bounds = ScreenBounds(surface, new Rect(0, 0, surface.ActualWidth, surface.ActualHeight));
            var clip = bounds;
            clip.Intersect(ScreenBounds(_owner, new Rect(0, 0, _owner.ActualWidth, _owner.ActualHeight)));
            DependencyObject? current = surface;
            while (current is Visual visual)
            {
                if (current is FrameworkElement ancestor && !ReferenceEquals(ancestor, surface))
                {
                    if (!ancestor.IsVisible || ancestor.Opacity <= 0) return false;
                    if (ancestor.ClipToBounds || ancestor is ScrollViewer || ancestor is ScrollContentPresenter)
                    {
                        clip.Intersect(ScreenBounds(ancestor, new Rect(0, 0, ancestor.ActualWidth, ancestor.ActualHeight)));
                    }
                    if (ancestor.Clip is Geometry explicitClip) clip.Intersect(ScreenBounds(ancestor, explicitClip.Bounds));
                }
                if (ReferenceEquals(current, _owner)) break;
                current = VisualTreeHelper.GetParent(visual);
            }
            if (clip.IsEmpty || clip.Width < 1 || clip.Height < 1) return false;

            var left = (int)Math.Floor(bounds.Left);
            var top = (int)Math.Floor(bounds.Top);
            var width = (int)Math.Ceiling(bounds.Right) - left;
            var height = (int)Math.Ceiling(bounds.Bottom) - top;
            var radius = surface is Border border
                ? Math.Max(Math.Max(border.CornerRadius.TopLeft, border.CornerRadius.TopRight), Math.Max(border.CornerRadius.BottomLeft, border.CornerRadius.BottomRight))
                : 15;
            var dpi = VisualTreeHelper.GetDpi(surface);
            var diameter = (int)Math.Ceiling(Math.Min(Math.Min(width, height), radius * 2 * Math.Max(dpi.DpiScaleX, dpi.DpiScaleY)));
            geometry = new SurfaceGeometry(left, top, width, height, diameter,
                Math.Max(0, (int)Math.Ceiling(clip.Left) - left), Math.Max(0, (int)Math.Ceiling(clip.Top) - top),
                Math.Min(width, (int)Math.Floor(clip.Right) - left), Math.Min(height, (int)Math.Floor(clip.Bottom) - top));
            return geometry.ClipRight > geometry.ClipLeft && geometry.ClipBottom > geometry.ClipTop;
        }
        catch (InvalidOperationException) { return false; } // A layout rebuild may detach the old surface.
    }

    private static Rect ScreenBounds(FrameworkElement element, Rect local)
    {
        var first = element.PointToScreen(local.TopLeft);
        var last = element.PointToScreen(local.BottomRight);
        return new Rect(first, last);
    }

    private static bool SetRegion(IntPtr window, SurfaceGeometry geometry)
    {
        var rounded = CreateRoundRectRgn(0, 0, geometry.Width + 1, geometry.Height + 1, geometry.Diameter, geometry.Diameter);
        if (rounded == IntPtr.Zero) return false;
        var clip = CreateRectRgn(geometry.ClipLeft, geometry.ClipTop, geometry.ClipRight, geometry.ClipBottom);
        if (clip == IntPtr.Zero) { DeleteObject(rounded); return false; }
        try
        {
            if (CombineRgn(rounded, rounded, clip, 1) == 0) { DeleteObject(rounded); return false; } // RGN_AND
            if (SetWindowRgn(window, rounded, true) != 0) return true; // HWND now owns the region.
            DeleteObject(rounded);
            return false;
        }
        finally { DeleteObject(clip); }
    }

    private static bool TransparencyEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("EnableTransparency") is not int enabled || enabled != 0;
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException) { return true; }
    }

    private static void EnsureRegistered()
    {
        lock (RegistrationLock)
        {
            if (_registered) return;
            var definition = new WindowClass
            {
                Size = (uint)Marshal.SizeOf<WindowClass>(),
                Procedure = Marshal.GetFunctionPointerForDelegate(Procedure),
                Instance = GetModuleHandle(null),
                ClassName = ClassName
            };
            if (RegisterClassEx(ref definition) == 0 && Marshal.GetLastWin32Error() != 1410)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            _registered = true;
        }
    }

    private static IntPtr WindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam) => message switch
    {
        0x0084 => new IntPtr(-1), // WM_NCHITTEST: HTTRANSPARENT
        0x0021 => new IntPtr(3), // WM_MOUSEACTIVATE: MA_NOACTIVATE
        0x0014 => new IntPtr(1), // WM_ERASEBKGND: let DWM compose the material, never paint an opaque GDI fill.
        _ => DefWindowProc(window, message, wParam, lParam)
    };

    private void OwnerMoved(object? sender, EventArgs e) => Refresh();
    private void OwnerResized(object sender, SizeChangedEventArgs e) => Refresh();
    private void OwnerVisibilityChanged(object sender, DependencyPropertyChangedEventArgs e) => Refresh();
    private void OwnerClosed(object? sender, EventArgs e) => Dispose();
    private void HideAll() { foreach (var backdrop in _backdrops.Values) Hide(backdrop); }
    private static void Hide(Backdrop backdrop)
    {
        if (!backdrop.Visible) return;
        ShowWindow(backdrop.Handle, 0);
        backdrop.Visible = false;
    }
    private static void Destroy(Backdrop backdrop) { DestroyWindow(backdrop.Handle); backdrop.Visible = false; }

    public void Dispose()
    {
        _owner.VerifyAccess();
        if (_disposed) return;
        _disposed = true;
        _owner.LocationChanged -= OwnerMoved;
        _owner.SizeChanged -= OwnerResized;
        _owner.IsVisibleChanged -= OwnerVisibilityChanged;
        _owner.StateChanged -= OwnerMoved;
        _owner.Closed -= OwnerClosed;
        foreach (var backdrop in _backdrops.Values) Destroy(backdrop);
        _backdrops.Clear();
        _surfaces = Array.Empty<FrameworkElement>();
    }

    private sealed class Backdrop(IntPtr handle)
    {
        public IntPtr Handle { get; } = handle;
        public SurfaceGeometry Geometry { get; set; }
        public bool Visible { get; set; }
    }
    private readonly record struct SurfaceGeometry(int Left, int Top, int Width, int Height, int Diameter, int ClipLeft, int ClipTop, int ClipRight, int ClipBottom);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WindowClass
    {
        public uint Size, Style;
        public IntPtr Procedure;
        public int ClassExtra, WindowExtra;
        public IntPtr Instance, Icon, Cursor, Background;
        [MarshalAs(UnmanagedType.LPWStr)] public string? MenuName;
        [MarshalAs(UnmanagedType.LPWStr)] public string ClassName;
        public IntPtr SmallIcon;
    }
    [StructLayout(LayoutKind.Sequential)] private struct AccentPolicy { public int State, Flags; public uint GradientColor; public int Animation; }
    [StructLayout(LayoutKind.Sequential)] private struct CompositionData { public int Attribute; public IntPtr Data; public nuint Size; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClassEx(ref WindowClass definition);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? module);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(uint extendedStyle, string className, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetWindowCompositionAttribute(IntPtr window, ref CompositionData data);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int widthEllipse, int heightEllipse);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] private static extern int CombineRgn(IntPtr destination, IntPtr first, IntPtr second, int mode);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteObject(IntPtr handle);
    [DllImport("user32.dll")] private static extern int SetWindowRgn(IntPtr window, IntPtr region, [MarshalAs(UnmanagedType.Bool)] bool redraw);
}
