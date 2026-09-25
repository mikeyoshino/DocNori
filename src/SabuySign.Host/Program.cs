using System.Security.Cryptography;
using System.Xml.Linq;
using SabuySign.Host.Components;
using SabuySign.Host.Features.MediaConversion;
using SabuySign.Host.Features.Seo;
using SabuySign.Host.Features.SigningSessions;
using SabuySign.Web.Features.Tools;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseStaticWebAssets();
builder.Services.AddRazorComponents().AddInteractiveWebAssemblyComponents();
builder.Services.AddSingleton(new PublicSite(builder.Configuration["PublicOrigin"] ?? "http://localhost:8080"));
builder.AddMedia();
builder.AddSigningSessions();
var app = builder.Build();
app.UseRateLimiter();
app.Use(async (context, next) =>
{
    var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
    context.Items["CspNonce"] = nonce;
    context.Response.Headers.ContentSecurityPolicy = $"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'nonce-{nonce}' 'strict-dynamic' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' blob: https:; connect-src 'self' https:; frame-src https:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    if (context.Request.Path.StartsWithSegments("/api") || !Path.HasExtension(context.Request.Path.Value))
    {
        context.Response.Headers.CacheControl = "no-store";
    }
    if (context.Request.Path == "/tools/merg")
    {
        context.Response.Redirect("/tools/merge", permanent: true);
        return;
    }
    await next();
});
app.UseAntiforgery();
app.MapStaticAssets();
await app.MapSigningSessions();
await app.MapMedia();
app.MapGet("/robots.txt", (PublicSite site) => Results.Text($"User-agent: *\nAllow: /\nDisallow: /sign\nDisallow: /api/\nSitemap: {site.Url("/sitemap.xml")}\n", "text/plain"));
app.MapGet("/sitemap.xml", (PublicSite site) =>
{
    XNamespace ns = "http://www.sitemaps.org/schemas/sitemap/0.9";
    var paths = new[] { "/" }.Concat(ToolCatalog.Tools.Where(t => t.Available).Select(t => $"/tools/{t.Id}"));
    return Results.Text(new XDocument(new XElement(ns + "urlset", paths.Select(path => new XElement(ns + "url", new XElement(ns + "loc", site.Url(path)))))).ToString(), "application/xml");
});
app.MapRazorComponents<App>().AddInteractiveWebAssemblyRenderMode();
app.Run();

public partial class Program { }
