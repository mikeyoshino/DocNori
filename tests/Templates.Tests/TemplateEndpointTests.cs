using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using SabuySign.Host.Features.DocumentTemplates;
using Xunit;

public class TemplateEndpointTests
{
    public sealed class TestIdentity(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var owner = Request.Headers["X-Test-Owner"].ToString();
            if (string.IsNullOrEmpty(owner)) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new[] { new Claim(ClaimTypes.NameIdentifier, owner), new Claim("email_verified", Request.Headers["X-Test-Verified"].ToString()) };
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name)), Scheme.Name)));
        }
    }
    private sealed class Harness : IAsyncDisposable
    {
        public WebApplication App { get; }
        public HttpClient Client { get; private set; } = null!;
        public string Owner { get; } = Guid.NewGuid().ToString();
        private readonly string root = Path.Combine(Path.GetTempPath(), "template-http-" + Guid.NewGuid().ToString("N"));
        private readonly bool configured;
        public Harness(bool configured = true, bool unusableVolume = false)
        {
            this.configured = configured;
            if (unusableVolume) File.WriteAllText(root, "blocks directory creation");
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Accounts:ConnectionString"] = unusableVolume ? "Host=127.0.0.1;Port=1;Database=test;Username=test;Timeout=1" : configured ? Environment.GetEnvironmentVariable("TEMPLATES_TEST_DB") : null, ["Templates:StoragePath"] = unusableVolume ? Path.Combine(root, "private") : root });
            builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, TestIdentity>("Test", _ => { });
            builder.Services.AddAuthorization(o => o.AddPolicy("AccountsVerified", p => p.RequireAuthenticatedUser().RequireClaim("email_verified", "true")));
            builder.Services.AddAntiforgery(o => o.HeaderName = "X-CSRF-TOKEN");
            builder.AddDocumentTemplates(); App = builder.Build(); App.UseAuthentication(); App.UseAuthorization(); App.UseAntiforgery();
            App.MapGet("/test/csrf", (HttpContext c, IAntiforgery a) => Results.Ok(new { token = a.GetAndStoreTokens(c).RequestToken }));
        }
        public async Task Start()
        {
            await App.MapDocumentTemplates(); await App.StartAsync();
            var address = App.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            Client = new HttpClient(new HttpClientHandler { UseCookies = true }) { BaseAddress = new Uri(address) };
        }
        public void Identify(string? owner = null, bool verified = true)
        {
            Client.DefaultRequestHeaders.Remove("X-Test-Owner"); Client.DefaultRequestHeaders.Add("X-Test-Owner", owner ?? Owner);
            Client.DefaultRequestHeaders.Remove("X-Test-Verified"); Client.DefaultRequestHeaders.Add("X-Test-Verified", verified ? "true" : "false");
        }
        public async Task Csrf()
        {
            var token = (await Client.GetFromJsonAsync<JsonElement>("/test/csrf")).GetProperty("token").GetString();
            Client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN"); Client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", token);
        }
        public async Task<HttpResponseMessage> Upload()
        {
            using var body = new MultipartFormDataContent(); body.Add(new StringContent("Private"), "name"); body.Add(new ByteArrayContent(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "plain.pdf"))), "file", "document.pdf");
            return await Client.PostAsync("/api/templates", body);
        }
        public async ValueTask DisposeAsync()
        {
            Client.Dispose(); await App.StopAsync(); await App.DisposeAsync();
            if (configured)
            {
                await using var c = new NpgsqlConnection(Environment.GetEnvironmentVariable("TEMPLATES_TEST_DB")); await c.OpenAsync();
                await using var cmd = new NpgsqlCommand("DELETE FROM document_templates WHERE owner_id=$1", c); cmd.Parameters.AddWithValue(Owner); await cmd.ExecuteNonQueryAsync();
            }
            if (Directory.Exists(root)) Directory.Delete(root, true);
            if (File.Exists(root)) File.Delete(root);
        }
    }
    [Fact]
    public async Task UnusableVolumeKeepsHostRunningAndReturnsServiceUnavailable()
    {
        await using var h = new Harness(configured: false, unusableVolume: true); await h.Start(); h.Identify();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await h.Client.GetAsync("/api/templates")).StatusCode);
    }
    [DatabaseFact]
    public async Task HttpRequiresVerifiedOwnerAndCsrfOnEveryMutation()
    {
        await using var h = new Harness(); await h.Start();
        Assert.Equal(HttpStatusCode.Unauthorized, (await h.Client.GetAsync("/api/templates")).StatusCode);
        h.Identify(verified: false); Assert.Equal(HttpStatusCode.Forbidden, (await h.Upload()).StatusCode);
        h.Identify(); Assert.Equal(HttpStatusCode.BadRequest, (await h.Upload()).StatusCode);
        await h.Csrf(); var uploaded = await h.Upload(); Assert.Equal(HttpStatusCode.Created, uploaded.StatusCode);
        var detail = (await uploaded.Content.ReadFromJsonAsync<TemplateDetail>())!;
        var list = await h.Client.GetAsync("/api/templates"); Assert.Equal("no-store", list.Headers.CacheControl!.ToString());
        h.Client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.BadRequest, (await h.Client.PutAsJsonAsync($"/api/templates/{detail.Id}", new TemplateSave("Changed", 1, TemplateDefinition.Empty))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await h.Client.PostAsJsonAsync($"/api/templates/{detail.Id}/duplicate", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await h.Client.DeleteAsync($"/api/templates/{detail.Id}")).StatusCode);
        h.Identify(Guid.NewGuid().ToString()); await h.Csrf();
        Assert.Equal(HttpStatusCode.NotFound, (await h.Client.GetAsync($"/api/templates/{detail.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await h.Client.GetAsync($"/api/templates/{detail.Id}/file")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await h.Client.PutAsJsonAsync($"/api/templates/{detail.Id}", new TemplateSave("Changed", 1, TemplateDefinition.Empty))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await h.Client.PostAsJsonAsync($"/api/templates/{detail.Id}/duplicate", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await h.Client.DeleteAsync($"/api/templates/{detail.Id}")).StatusCode);
        h.Identify(); await h.Csrf(); Assert.Equal(HttpStatusCode.NoContent, (await h.Client.DeleteAsync($"/api/templates/{detail.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await h.Client.GetAsync($"/api/templates/{detail.Id}/file")).StatusCode);
    }
    [Fact]
    public async Task UnconfiguredStorageReturns503()
    {
        await using var h = new Harness(false); await h.Start(); h.Identify();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await h.Client.GetAsync("/api/templates")).StatusCode);
    }
}
