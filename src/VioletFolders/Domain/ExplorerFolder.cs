using System;

namespace VioletFolders.Domain;

public sealed record ExplorerFolder(string Path, IntPtr WindowHandle);
