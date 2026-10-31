using System;
using System.Collections;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using VioletFolders.UI;

internal static class NativeBackdropSmoke
{
    public static async Task Run()
    {
        var checks = 0;
        void Check(bool value, string message)
        {
            if (!value) throw new InvalidOperationException(message);
            checks++;
            Console.WriteLine("PASS " + message);
        }
        var header = new Border { Height = 44, Width = 260, CornerRadius = new CornerRadius(22), Background = new SolidColorBrush(Color.FromArgb(100, 70, 40, 90)), VerticalAlignment = VerticalAlignment.Top };
        var first = Pill();
        var second = Pill();
        var third = Pill();
        var rows = new StackPanel();
        rows.Children.Add(first); rows.Children.Add(second); rows.Children.Add(third);
        var scroll = new ScrollViewer { Content = rows, Height = 100, Margin = new Thickness(0, 60, 0, 0), VerticalAlignment = VerticalAlignment.Top, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
        var content = new Grid(); content.Children.Add(header); content.Children.Add(scroll);
        var owner = new Window { Content = content, Width = 300, Height = 220, AllowsTransparency = true, WindowStyle = WindowStyle.None, Background = Brushes.Transparent, Left = -20000, Top = 0, Opacity = 0, ShowInTaskbar = false, ShowActivated = false, Topmost = true };
        var surfaces = new FrameworkElement[] { header, first, second, third };
        using var helper = new NativeGlassBackdrop(owner);
        try
        {
            helper.Update(surfaces);
            Check(helper.ActiveWindowCount == 0, "An unshown owner creates no visible native backdrops");
            owner.Show();
            await Task.Delay(100);
            owner.UpdateLayout();
            helper.Update(surfaces);
            Check(helper.ActiveWindowCount == 0, "An opacity-zero owner creates no visible native backdrops");
            owner.Opacity = 1;
            owner.UpdateLayout();
            helper.Update(surfaces);
            Check(helper.IsAvailable && helper.ActiveWindowCount == 3, "Visible pills create acrylic HWNDs while the fully clipped third row creates none");
            var handles = Handles(helper);
            Check(handles.All(window => !IsWindowEnabled(window) && (GetWindowLongPtr(window, -20).ToInt64() & 0x080000A0) == 0x080000A0 && GetWindow(window, 4) == IntPtr.Zero),
                "Backdrop HWNDs are disabled, nonactivating, transparent tool windows with no native owner");
            Check(handles.All(window => SendMessage(window, 0x84, IntPtr.Zero, IntPtr.Zero) == new IntPtr(-1) && SendMessage(window, 0x21, IntPtr.Zero, IntPtr.Zero) == new IntPtr(3)),
                "Backdrop hit testing and mouse activation explicitly pass through without activation");
            var secondHandle = HandleFor(helper, second);
            var region = CreateRectRgn(0, 0, 0, 0);
            try
            {
                Check(GetWindowRgn(secondHandle, region) != 0 && GetRgnBox(region, out var box) != 0 && box.Bottom - box.Top < 30,
                    "A partially scrolled row's native rounded region is clipped to the actual viewport");
            }
            finally { DeleteObject(region); }
            GetWindowRect(handles[0], out var before);
            owner.Left -= 30;
            helper.Update(surfaces);
            GetWindowRect(handles[0], out var after);
            Check(after.Left == before.Left - 30, "Native backdrops follow owner movement without recreating the HWND");
            owner.Hide();
            Check(helper.ActiveWindowCount == 0 && handles.All(window => !IsWindowVisible(window)), "Hiding the owner immediately hides every native backdrop");
            owner.Show();
            owner.UpdateLayout();
            helper.Update(surfaces);
            Check(helper.ActiveWindowCount == 3, "Showing the owner restores only its visible clipped surfaces");
            scroll.Visibility = Visibility.Collapsed;
            owner.UpdateLayout();
            helper.Update(surfaces);
            Check(helper.ActiveWindowCount == 1, "Collapsing the folder area leaves only the header backdrop visible");
            helper.Update(Array.Empty<FrameworkElement>());
            Check(helper.ActiveWindowCount == 0 && handles.All(window => !IsWindow(window)), "Removing surfaces destroys every corresponding native window");
            helper.Update(new[] { header });
            var last = Handles(helper).Single();
            owner.Close();
            Check(helper.ActiveWindowCount == 0 && !IsWindow(last), "Closing the owner automatically destroys the remaining native backdrop");
            Console.WriteLine($"{checks}/{checks} native acrylic lifecycle checks passed.");
        }
        finally { owner.Close(); }
    }

    private static Border Pill() => new() { Height = 72, Width = 280, Margin = new Thickness(0, 0, 0, 10), CornerRadius = new CornerRadius(30), Background = new SolidColorBrush(Color.FromArgb(80, 60, 30, 90)) };
    private static IDictionary Backdrops(NativeGlassBackdrop helper) => (IDictionary)typeof(NativeGlassBackdrop).GetField("_backdrops", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(helper)!;
    private static IntPtr HandleFor(NativeGlassBackdrop helper, FrameworkElement surface)
    {
        var entry = Backdrops(helper)[surface]!;
        return (IntPtr)entry.GetType().GetProperty("Handle")!.GetValue(entry)!;
    }
    private static IntPtr[] Handles(NativeGlassBackdrop helper) => Backdrops(helper).Values.Cast<object>().Select(entry => (IntPtr)entry.GetType().GetProperty("Handle")!.GetValue(entry)!).ToArray();
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr first, IntPtr second);
    [DllImport("user32.dll")] private static extern int GetWindowRgn(IntPtr window, IntPtr region);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetWindowRect(IntPtr window, out NativeRect rectangle);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] private static extern int GetRgnBox(IntPtr region, out NativeRect rectangle);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteObject(IntPtr handle);
}
