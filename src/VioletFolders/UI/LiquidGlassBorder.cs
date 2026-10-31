using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace VioletFolders.UI;

/// <summary>A thick optical rim and curved highlights around an independent glass surface.</summary>
internal sealed class LiquidGlassBorder : Border
{
    public LiquidGlassBorder()
    {
        CornerRadius = new CornerRadius(30);
        BorderThickness = new Thickness(1);
        Background = Brushes.Transparent;
        SnapsToDevicePixels = true;
    }

    protected override void OnRender(DrawingContext dc)
    {
        if (ActualWidth < 4 || ActualHeight < 4) return;
        var bounds = new Rect(.8, .8, ActualWidth - 1.6, ActualHeight - 1.6);
        var radius = Math.Min(CornerRadius.TopLeft, ActualHeight / 2);
        var fill = new LinearGradientBrush { StartPoint = new Point(.05, 0), EndPoint = new Point(.9, 1) };
        fill.GradientStops.Add(new GradientStop(Color.FromArgb(70, 209, 195, 233), 0));
        fill.GradientStops.Add(new GradientStop(Color.FromArgb(126, 52, 37, 71), .28));
        fill.GradientStops.Add(new GradientStop(Color.FromArgb(155, 27, 20, 39), .62));
        fill.GradientStops.Add(new GradientStop(Color.FromArgb(110, 121, 95, 148), 1));
        dc.DrawRoundedRectangle(fill, null, bounds, radius, radius);

        // A wide inner meniscus creates material thickness rather than a flat outline.
        var inner = new Rect(3.2, 3.2, ActualWidth - 6.4, ActualHeight - 6.4);
        var edge = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(.2, 1) };
        edge.GradientStops.Add(new GradientStop(Color.FromArgb(95, 255, 248, 255), 0));
        edge.GradientStops.Add(new GradientStop(Color.FromArgb(15, 227, 210, 255), .22));
        edge.GradientStops.Add(new GradientStop(Color.FromArgb(5, 99, 71, 129), .58));
        edge.GradientStops.Add(new GradientStop(Color.FromArgb(55, 235, 222, 255), 1));
        dc.DrawRoundedRectangle(null, new Pen(edge, 3.5), inner, radius - 2, radius - 2);

        var rim = new LinearGradientBrush { StartPoint = new Point(.08, 0), EndPoint = new Point(.82, 1) };
        rim.GradientStops.Add(new GradientStop(Color.FromArgb(240, 247, 239, 255), 0));
        rim.GradientStops.Add(new GradientStop(Color.FromArgb(110, 202, 179, 226), .3));
        rim.GradientStops.Add(new GradientStop(Color.FromArgb(38, 96, 74, 115), .62));
        rim.GradientStops.Add(new GradientStop(Color.FromArgb(208, 235, 219, 251), 1));
        dc.DrawRoundedRectangle(null, new Pen(rim, 1.1), bounds, radius, radius);

        var sheen = new RadialGradientBrush(Color.FromArgb(26, 255, 255, 255), Colors.Transparent)
        { Center = new Point(.12, .08), GradientOrigin = new Point(.1, 0), RadiusX = .6, RadiusY = .8 };
        dc.DrawRoundedRectangle(sheen, null, new Rect(5, 3, ActualWidth - 10, ActualHeight - 6), radius - 4, radius - 4);
    }
}
