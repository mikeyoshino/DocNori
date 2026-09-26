using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SabuySign.Host.Features.Accounts;
using Xunit;

namespace Accounts.Tests;

public class AccountOriginTests
{
    [Fact]
    public async Task ProxyHttpUsesConfiguredOriginForCsrfAndGoogleCallbackOnly()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Accounts:ConnectionString"] = "configured-test",
            ["Accounts:PublicOrigin"] = "https://trusted.example:8443",
            ["Accounts:Google:ClientId"] = "test-client",
            ["Accounts:Google:ClientSecret"] = "test-secret"
        });
        builder.AddAccounts();
        builder.Services.AddSingleton<IAccountDatabase>(new ReadyDatabase());
        await using var app = builder.Build();
        app.UseAccountsOrigin(); app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter(); app.UseAntiforgery(); app.MapAccounts();
        app.MapGet("/public-origin", (HttpContext context) => Results.Ok(new { scheme = context.Request.Scheme, host = context.Request.Host.Value }));
        await app.StartAsync();
        using var client = app.GetTestClient(); client.BaseAddress = new Uri("http://internal-proxy");
        client.DefaultRequestHeaders.Add("X-Forwarded-Host", "evil.example");
        client.DefaultRequestHeaders.Add("X-Forwarded-Proto", "http");
        var csrf = await client.GetAsync("/api/account/csrf");
        Assert.Equal(HttpStatusCode.OK, csrf.StatusCode);
        Assert.Contains("secure", csrf.Headers.GetValues("Set-Cookie").Single());
        var challenge = await client.GetAsync("/api/account/google");
        Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);
        var query = QueryHelpers.ParseQuery(challenge.Headers.Location!.Query);
        Assert.Equal("https://trusted.example:8443/signin-google", query["redirect_uri"].ToString());
        var unchanged = await client.GetFromJsonAsync<JsonElement>("/public-origin");
        Assert.Equal("http", unchanged.GetProperty("scheme").GetString());
        Assert.Equal("internal-proxy", unchanged.GetProperty("host").GetString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("http://trusted.example")]
    [InlineData("https://trusted.example/path")]
    public async Task InvalidOriginsDoNotRewriteRequests(string? origin)
    {
        var builder = WebApplication.CreateBuilder(); builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Accounts:PublicOrigin"] = origin });
        builder.AddAccounts();
        await using var app = builder.Build(); app.UseAccountsOrigin();
        app.MapGet("/api/templates/origin", (HttpContext context) => context.Request.Scheme + "://" + context.Request.Host);
        await app.StartAsync(); using var client = app.GetTestClient(); client.BaseAddress = new Uri("http://internal-proxy");
        Assert.Equal("http://internal-proxy", await client.GetStringAsync("/api/templates/origin"));
    }
    [Fact]
    public async Task AuthenticatedUsersBehindOneProxyHaveIndependentRateLimits()
    {
        var builder = WebApplication.CreateBuilder(); builder.WebHost.UseTestServer(); builder.AddAccounts();
        await using var app = builder.Build(); app.UseAuthentication();
        app.Use(async (context, next) =>
        {
            var testUser = context.Request.Headers["X-Test-User"].ToString();
            context.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
                [new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, testUser)], "test"));
            await next();
        });
        app.UseRateLimiter(); app.MapGet("/limited", () => "ok").RequireRateLimiting("accounts");
        await app.StartAsync(); using var client = app.GetTestClient();
        client.DefaultRequestHeaders.Add("X-Test-User", "account-a");
        for (var i = 0; i < 20; i++) Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/limited")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/limited")).StatusCode);
        client.DefaultRequestHeaders.Remove("X-Test-User"); client.DefaultRequestHeaders.Add("X-Test-User", "account-b");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/limited")).StatusCode);
    }

    private sealed class ReadyDatabase : IAccountDatabase
    { public Task<bool> ReadyAsync(CancellationToken cancellationToken = default) => Task.FromResult(true); }
}
