using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using VioletFolders.Domain;

namespace VioletFolders.Services;

public sealed class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public SettingsStore(string? directory = null)
    {
        DirectoryPath = directory ?? System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VioletFolders");
    }

    public string DirectoryPath { get; }
    public string SettingsPath => System.IO.Path.Combine(DirectoryPath, "settings.json");

    public AppSettings Load()
    {
        try
        {
            if (!File.Exists(SettingsPath)) return new();
            var settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(SettingsPath), JsonOptions) ?? new();
            settings.PinnedPaths = (settings.PinnedPaths ?? []).Select(FolderPath.Normalize).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            settings.Language = settings.Language == "en" ? "en" : "zh-CN";
            if (!double.IsFinite(settings.Left)) settings.Left = 12;
            if (!double.IsFinite(settings.Top)) settings.Top = 12;
            settings.Width = double.IsFinite(settings.Width) ? Math.Clamp(settings.Width, 340, 800) : 480;
            return settings;
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException or NotSupportedException)
        {
            // Keep the original damaged/unreadable file for recovery; don't overwrite until an actual user change.
            return new();
        }
    }

    public void Save(AppSettings settings)
    {
        Directory.CreateDirectory(DirectoryPath);
        var temporary = SettingsPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(settings, JsonOptions));
            File.Move(temporary, SettingsPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
}
