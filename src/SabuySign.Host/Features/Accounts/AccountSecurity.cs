namespace SabuySign.Host.Features.Accounts;

public static class AccountSecurity
{
    public static string LocalReturnUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "/workspace/templates";
        var decoded = Uri.UnescapeDataString(value);
        return decoded.StartsWith('/') && !decoded.StartsWith("//", StringComparison.Ordinal)
            && !decoded.Contains('\\') && !decoded.Any(char.IsControl)
            ? value : "/workspace/templates";
    }

    public static bool IsPublicOrigin(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == "https" && uri.AbsolutePath == "/" && uri.UserInfo == ""
        && uri.Query == "" && uri.Fragment == "";
}

public sealed class AccountOptions
{
    public string? ConnectionString { get; set; }
    public string? PublicOrigin { get; set; }
    public GoogleOptions Google { get; set; } = new();
    public SmtpOptions Smtp { get; set; } = new();
    public bool Available => !string.IsNullOrWhiteSpace(ConnectionString);
    public bool GoogleEnabled => Available && AccountSecurity.IsPublicOrigin(PublicOrigin)
        && !string.IsNullOrWhiteSpace(Google.ClientId) && !string.IsNullOrWhiteSpace(Google.ClientSecret);
    public bool EmailEnabled => Available && AccountSecurity.IsPublicOrigin(PublicOrigin)
        && !string.IsNullOrWhiteSpace(Smtp.Host) && !string.IsNullOrWhiteSpace(Smtp.From);
}
public sealed class GoogleOptions { public string? ClientId { get; set; } public string? ClientSecret { get; set; } }
public sealed class SmtpOptions
{
    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public string? User { get; set; }
    public string? Password { get; set; }
    public string? From { get; set; }
}
