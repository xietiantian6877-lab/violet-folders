using System.Collections.Generic;

namespace VioletFolders.Services;

public sealed class AppSettings
{
    public List<string> PinnedPaths { get; set; } = [];
    public string Language { get; set; } = "zh-CN";
    public bool Collapsed { get; set; }
    public double Left { get; set; } = 12;
    public double Top { get; set; } = 12;
    public bool LaunchAtLogin { get; set; }
    public double Width { get; set; } = 480;
}
