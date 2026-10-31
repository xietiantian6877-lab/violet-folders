using System;

namespace VioletFolders.Domain;

/// <summary>Canonical, case-insensitive identities for absolute Windows folder paths.</summary>
public static class FolderPath
{
    public static string? Normalize(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        try
        {
            path = path.Replace('/', '\\');
            if (!System.IO.Path.IsPathFullyQualified(path)) return null;
            var full = System.IO.Path.GetFullPath(path);
            var root = System.IO.Path.GetPathRoot(full);
            if (string.IsNullOrEmpty(root)) return null;
            return full.Length > root.Length ? full.TrimEnd('\\') : full;
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or System.IO.PathTooLongException)
        {
            return null;
        }
    }

    public static string Name(string path)
    {
        var name = System.IO.Path.GetFileName(path.TrimEnd('\\'));
        return string.IsNullOrEmpty(name) ? path : name;
    }

    public static string Parent(string path)
    {
        var parent = System.IO.Path.GetDirectoryName(path);
        return string.IsNullOrEmpty(parent) ? string.Empty : parent.TrimEnd('\\') + "\\";
    }
}
