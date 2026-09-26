namespace SabuySign.Host.Features.DocumentTemplates;

public interface ITemplateFileStore
{
    Task Write(string key, byte[] bytes, CancellationToken ct);
    Task<byte[]> Read(string key, CancellationToken ct);
    void Delete(string key);
    IEnumerable<string> OldFiles(DateTime utcBefore);
}
public sealed class TemplateFileStore : ITemplateFileStore
{
    private readonly string root;
    public TemplateFileStore(string path, string? webRoot)
    {
        root = Path.GetFullPath(path);
        if (!string.IsNullOrWhiteSpace(webRoot))
        {
            var www = Path.GetFullPath(webRoot).TrimEnd(Path.DirectorySeparatorChar);
            if (root.Equals(www, StringComparison.OrdinalIgnoreCase) || root.StartsWith(www + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Templates:StoragePath must be outside wwwroot.");
        }
        Directory.CreateDirectory(root);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }
    private string PathFor(string key)
    {
        if (!Guid.TryParseExact(key, "N", out _)) throw new ArgumentException("Invalid storage key.");
        return Path.Combine(root, key + ".pdf");
    }
    public async Task Write(string key, byte[] bytes, CancellationToken ct)
    {
        var target = PathFor(key);
        // Keys are random and exclusive; unreferenced partial files are removed by cleanup.
        await using var stream = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(target, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        await stream.WriteAsync(bytes, ct);
        await stream.FlushAsync(ct);
    }
    public async Task<byte[]> Read(string key, CancellationToken ct)
    {
        try { return await File.ReadAllBytesAsync(PathFor(key), ct); }
        catch (FileNotFoundException) { throw new TemplateFailure(404, "ไม่พบไฟล์แม่แบบ"); }
    }
    public void Delete(string key) => File.Delete(PathFor(key));
    public IEnumerable<string> OldFiles(DateTime utcBefore) => Directory.EnumerateFiles(root, "*.pdf")
        .Where(p => File.GetLastWriteTimeUtc(p) < utcBefore)
        .Select(Path.GetFileNameWithoutExtension).OfType<string>().Where(k => Guid.TryParseExact(k, "N", out _));
}
