using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace VioletFolders.Domain;

public sealed class FolderEntry : INotifyPropertyChanged
{
    private bool _isPinned;
    private bool _isOpen;
    private IntPtr _windowHandle;

    public FolderEntry(string path, bool isPinned = false)
    {
        Path = FolderPath.Normalize(path) ?? throw new ArgumentException("An absolute folder path is required.", nameof(path));
        Name = FolderPath.Name(Path);
        ParentPath = FolderPath.Parent(Path);
        _isPinned = isPinned;
    }

    public string Path { get; }
    public string Name { get; }
    /// <summary>Parent prefix, including its final separator; empty for a drive root.</summary>
    public string ParentPath { get; }
    public bool IsPinned { get => _isPinned; set => Set(ref _isPinned, value); }
    public bool IsOpen { get => _isOpen; set => Set(ref _isOpen, value); }
    public IntPtr WindowHandle { get => _windowHandle; set => Set(ref _windowHandle, value); }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
