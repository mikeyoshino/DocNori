namespace SabuySign.Host.Features.Seo;

public sealed class PublicSite
{
    private readonly string Origin;
    public PublicSite(string origin)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http") || uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) || !string.IsNullOrEmpty(uri.UserInfo))
            throw new InvalidOperationException("PublicOrigin must be an absolute HTTP(S) origin without a path, credentials, query or fragment.");
        Origin = uri.GetLeftPart(UriPartial.Authority);
    }
    public string Url(string path) => Origin + path;
}
