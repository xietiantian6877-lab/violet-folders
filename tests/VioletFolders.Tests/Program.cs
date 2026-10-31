using VioletFolders.Domain;
using VioletFolders.Services;

if (args.Contains("--explorer-smoke")) return ExplorerSmoke.Run();

var tests = new (string Name, Action Run)[]
{
    ("Opening folders creates separate rows and highlights the final segment", () =>
    {
        var catalog = new FolderCatalog([]);
        catalog.Reconcile([new(@"F:\9.21\培训集合\店铺授权", (IntPtr)11), new(@"F:\9.21\公司自生", (IntPtr)12)]);
        Equal(2, catalog.Entries.Count);
        Equal("店铺授权", catalog.Entries[0].Name);
        Equal(@"F:\9.21\培训集合\", catalog.Entries[0].ParentPath);
        True(catalog.Entries.All(e => e.IsOpen));
    }),
    ("Closing unpinned folders removes them", () =>
    {
        var catalog = new FolderCatalog([]);
        catalog.Reconcile([new(@"C:\Example\A", (IntPtr)1), new(@"C:\Example\B", (IntPtr)2)]);
        catalog.Reconcile([]);
        Equal(0, catalog.Entries.Count);
    }),
    ("Pinned folders persist when Explorer closes and unpin removes closed rows", () =>
    {
        var catalog = new FolderCatalog([]);
        var pinChanges = 0;
        catalog.PinsChanged += () => pinChanges++;
        catalog.Reconcile([new(@"C:\Example\A", (IntPtr)1)]);
        var entry = catalog.Entries.Single();
        catalog.TogglePin(entry);
        catalog.Reconcile([]);
        Equal(1, catalog.Entries.Count);
        True(entry.IsPinned && !entry.IsOpen && entry.WindowHandle == IntPtr.Zero);
        Equal(@"C:\Example\A", catalog.PinnedPaths.Single());
        catalog.TogglePin(entry);
        Equal(0, catalog.Entries.Count);
        Equal(2, pinChanges);
    }),
    ("Duplicate windows are merged case-insensitively and survive one window closing", () =>
    {
        var catalog = new FolderCatalog([]);
        catalog.Reconcile([new(@"C:\Example\A\", (IntPtr)1), new(@"c:\example\a", (IntPtr)2)]);
        Equal(1, catalog.Entries.Count);
        var original = catalog.Entries.Single();
        catalog.Reconcile([new(@"c:\example\a", (IntPtr)2)]);
        True(ReferenceEquals(original, catalog.Entries.Single()));
        Equal((IntPtr)2, original.WindowHandle);
    }),
    ("Navigation replaces unpinned paths while retaining pinned paths", () =>
    {
        var catalog = new FolderCatalog([@"C:\Example\Pinned"]);
        catalog.Reconcile([new(@"C:\Example\Pinned", (IntPtr)1), new(@"C:\Example\Old", (IntPtr)2)]);
        catalog.Reconcile([new(@"C:\Example\New", (IntPtr)2)]);
        Equal(2, catalog.Entries.Count);
        True(catalog.Entries.Single(e => e.IsPinned).IsOpen == false);
        Equal(@"C:\Example\New", catalog.Entries.Single(e => e.IsOpen).Path);
    }),
    ("Pinned paths restore without duplicates or invalid paths", () =>
    {
        var catalog = new FolderCatalog([@"F:\中文 空格\100%", @"f:\中文 空格\100%\", "", "relative", "https://example.test"]);
        Equal(1, catalog.Entries.Count);
        True(catalog.Entries[0].IsPinned && !catalog.Entries[0].IsOpen);
        Equal("100%", catalog.Entries[0].Name);
    }),
    ("Path handling preserves roots and UNC folders", () =>
    {
        Equal(@"C:\", FolderPath.Normalize(@"C:\"));
        Equal(@"\\server\share\资料", FolderPath.Normalize(@"\\server\share\资料\"));
        Equal(@"C:\", new FolderEntry(@"C:\").Name);
        Equal(string.Empty, new FolderEntry(@"C:\").ParentPath);
        Equal(@"C:\Test\Child", FolderPath.Normalize("C:/Test/Child/"));
        True(FolderPath.Normalize("relative\\child") is null);
        True(FolderPath.Normalize("C:relative") is null);
    }),
    ("Bindings are notified only when mutable values actually change", () =>
    {
        var entry = new FolderEntry(@"C:\Example");
        var notifications = new List<string?>();
        entry.PropertyChanged += (_, args) => notifications.Add(args.PropertyName);
        entry.IsPinned = true;
        entry.IsPinned = true;
        entry.IsOpen = true;
        entry.WindowHandle = (IntPtr)42;
        Equal("IsPinned,IsOpen,WindowHandle", string.Join(',', notifications));
    }),
    ("Settings atomically roundtrip pins, language, position and collapse", () => WithTemporaryStore(store =>
    {
        store.Save(new AppSettings { PinnedPaths = [@"F:\Example\中文 空格"], Language = "en", Collapsed = true, Left = 54, Top = 18, Width = 600, LaunchAtLogin = true });
        var settings = store.Load();
        Equal(@"F:\Example\中文 空格", settings.PinnedPaths.Single());
        Equal("en", settings.Language);
        True(settings.Collapsed && settings.LaunchAtLogin);
        Equal(54d, settings.Left);
        Equal(600d, settings.Width);
        Equal(1, Directory.GetFiles(store.DirectoryPath).Length);
    })),
    ("Missing and corrupt settings recover without deleting the damaged file", () => WithTemporaryStore(store =>
    {
        Equal(0, store.Load().PinnedPaths.Count);
        Directory.CreateDirectory(store.DirectoryPath);
        File.WriteAllText(store.SettingsPath, "{ damaged JSON");
        var settings = store.Load();
        Equal(0, settings.PinnedPaths.Count);
        Equal("zh-CN", settings.Language);
        Equal("{ damaged JSON", File.ReadAllText(store.SettingsPath));
    })),
    ("Opening an unavailable pinned path reports a missing directory without losing its pin", () =>
    {
        var path = Path.Combine(Path.GetTempPath(), "VioletFolders-missing-" + Guid.NewGuid().ToString("N"));
        var entry = new FolderEntry(path, true);
        var reportedMissing = false;
        try { FolderLauncher.Open(entry); }
        catch (DirectoryNotFoundException) { reportedMissing = true; }
        True(reportedMissing && entry.IsPinned && !entry.IsOpen && !Directory.Exists(path));
    }),
    ("Malformed settings fields are sanitized", () => WithTemporaryStore(store =>
    {
        Directory.CreateDirectory(store.DirectoryPath);
        File.WriteAllText(store.SettingsPath, "{\"PinnedPaths\":[\"C:\\\\Example\",\"c:\\\\example\",\"relative\"],\"Language\":\"unknown\",\"Width\":9000}");
        var settings = store.Load();
        Equal(1, settings.PinnedPaths.Count);
        Equal("zh-CN", settings.Language);
        Equal(800d, settings.Width);
    }))
};

var failures = 0;
foreach (var (name, run) in tests)
{
    try { run(); Console.WriteLine($"PASS {name}"); }
    catch (Exception ex) { failures++; Console.Error.WriteLine($"FAIL {name}: {ex.Message}"); }
}
Console.WriteLine($"{tests.Length - failures}/{tests.Length} tests passed.");
return failures == 0 ? 0 : 1;

static void True(bool condition)
{
    if (!condition) throw new InvalidOperationException("Expected true.");
}

static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected '{expected}', got '{actual}'.");
}

static void WithTemporaryStore(Action<SettingsStore> run)
{
    var directory = Path.Combine(Path.GetTempPath(), "VioletFolders-tests-" + Guid.NewGuid().ToString("N"));
    try { run(new SettingsStore(directory)); }
    finally { if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true); }
}
