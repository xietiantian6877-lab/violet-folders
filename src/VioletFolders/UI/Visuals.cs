using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Automation;

namespace VioletFolders.UI;

internal static class Visuals
{
    public static Brush Brush(string value) => (Brush)new BrushConverter().ConvertFromString(value)!;
    public static readonly Brush Ink = Brush("#FFF8FF"), Muted = Brush("#DFD1ED"), Accent = Brush("#F3E5FF");
    public static Border Glass(UIElement content, double radius = 30)
    {
        return new LiquidGlassBorder { CornerRadius = new CornerRadius(radius), Child = content };
    }
    public static FrameworkElement Icon(string name, double size = 17, Brush? stroke = null)
    {
        string data = name switch
        {
            "folder" => "M3,7 L3,18 Q3,20 5,20 L19,20 Q21,20 21,18 L21,8 Q21,6 19,6 L12,6 L10,3 L5,3 Q3,3 3,5 Z M3,9 L21,9",
            "pin" => "M8,3 L16,3 M9,3 L9,9 L6,13 L6,14 L18,14 L18,13 L15,9 L15,3 M12,14 L12,21",
            "pinned" => "M8,3 L16,3 L15,9 L18,13 L18,14 L6,14 L6,13 L9,9 L9,3 M12,14 L12,21",
            "up" => "M6,15 L12,9 L18,15",
            "down" => "M6,9 L12,15 L18,9",
            "more" => "M5,11 L5,13 M12,11 L12,13 M19,11 L19,13",
            "logo" => "M3,6 L9,18 Q12,23 15,17 L21,5 M8,5 L12,13 L16,5",
            "grip" => "M8,6 L8,7 M8,12 L8,13 M8,18 L8,19 M15,6 L15,7 M15,12 L15,13 M15,18 L15,19",
            _ => "M6,6 L18,18 M18,6 L6,18"
        };
        return new Path { Data = Geometry.Parse(data), Stroke = stroke ?? Muted, StrokeThickness = 1.65, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round, Stretch = Stretch.Uniform, Width = size, Height = size };
    }
    public static Button Button(string icon, string label, Action action, double width = 32)
    {
        var button = new Button { Content = Icon(icon), Style = (Style)Application.Current.FindResource("QuietButton"), Width = width, Height = 32, ToolTip = label };
        AutomationProperties.SetName(button, label);
        button.Click += (_, _) => action();
        return button;
    }
    public static TextBlock Text(string text, double size, Brush? color = null) => new() { Text = text, FontSize = size, Foreground = color ?? Ink, VerticalAlignment = VerticalAlignment.Center };
}
