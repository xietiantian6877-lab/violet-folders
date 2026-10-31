using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

namespace VioletFolders.Domain;

/// <summary>Reconciles live Explorer folders with the user's explicitly retained folders.</summary>
/// <remarks>Call from the UI thread. Existing entry identities and order are retained.</remarks>
public sealed class FolderCatalog
{
    public FolderCatalog(IEnumerable<string> pinnedPaths)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in pinnedPaths)
        {
            var normalized = FolderPath.Normalize(path);
            if (normalized is not null && seen.Add(normalized)) Entries.Add(new FolderEntry(normalized, true));
        }
    }

    public ObservableCollection<FolderEntry> Entries { get; } = [];
    public IEnumerable<string> PinnedPaths => Entries.Where(e => e.IsPinned).Select(e => e.Path).ToArray();
    public event Action? PinsChanged;

    public void Reconcile(IReadOnlyList<ExplorerFolder> snapshot)
    {
        var open = new Dictionary<string, ExplorerFolder>(StringComparer.OrdinalIgnoreCase);
        foreach (var folder in snapshot)
        {
            var path = FolderPath.Normalize(folder.Path);
            if (path is not null) open.TryAdd(path, folder);
        }

        // Work backwards so a removal cannot skip its next neighbour.
        for (var index = Entries.Count - 1; index >= 0; index--)
        {
            var entry = Entries[index];
            entry.IsOpen = open.TryGetValue(entry.Path, out var current);
            entry.WindowHandle = current?.WindowHandle ?? IntPtr.Zero;
            if (!entry.IsOpen && !entry.IsPinned) Entries.RemoveAt(index);
            open.Remove(entry.Path);
        }
        foreach (var (path, folder) in open)
        {
            Entries.Add(new FolderEntry(path) { IsOpen = true, WindowHandle = folder.WindowHandle });
        }
    }

    public void TogglePin(FolderEntry entry)
    {
        if (!Entries.Contains(entry)) return;
        entry.IsPinned = !entry.IsPinned;
        if (!entry.IsPinned && !entry.IsOpen) Entries.Remove(entry);
        PinsChanged?.Invoke();
    }
}
