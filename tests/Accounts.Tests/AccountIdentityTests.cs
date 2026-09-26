using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using SabuySign.Host.Features.Accounts;
using Xunit;

namespace Accounts.Tests;

public class AccountIdentityTests
{
    private static WebApplication BuildApp(bool inMemory = false, CaptureEmailSender? capture = null)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        if (capture is not null) builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Accounts:PublicOrigin"] = "https://docnori.com",
            ["Accounts:ConnectionString"] = "configured-test-only",
            ["Accounts:Smtp:Host"] = "unused.example.test",
            ["Accounts:Smtp:From"] = "test@example.test"
        });
        builder.AddAccounts();
        if (inMemory)
        {
            builder.Services.RemoveAll<AccountDbContext>();
            builder.Services.RemoveAll<DbContextOptions<AccountDbContext>>();
            builder.Services.RemoveAll<Microsoft.EntityFrameworkCore.Infrastructure.IDbContextOptionsConfiguration<AccountDbContext>>();
            var databaseName = Guid.NewGuid().ToString();
            builder.Services.AddDbContext<AccountDbContext>(options => options.UseInMemoryDatabase(databaseName));
        }
        if (capture is not null)
        {
            builder.Services.AddSingleton<IAccountDatabase>(new ReadyDatabase());
            builder.Services.AddSingleton<IAccountEmailSender>(capture);
        }
        var app = builder.Build();
        app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter(); app.UseAntiforgery(); app.MapAccounts();
        app.MapGet("/verified", () => "ok").RequireAuthorization("AccountsVerified");
        return app;
    }

    [Fact]
    public async Task DisabledAccountsExposeStatusAndEnforceCsrf()
    {
        await using var app = BuildApp();
        await app.StartAsync();
        using var client = app.GetTestClient();
        client.BaseAddress = new Uri("https://localhost");
        var me = await client.GetFromJsonAsync<JsonElement>("/api/account/me");
        Assert.False(me.GetProperty("available").GetBoolean());
        Assert.False(me.GetProperty("authenticated").GetBoolean());
        Assert.False(me.GetProperty("emailEnabled").GetBoolean());
        Assert.False(me.GetProperty("googleLinked").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/account/login", new { email = "a@b.com", password = "Abcd1234567!" })).StatusCode);
        var response = await client.GetAsync("/api/account/csrf");
        var csrf = await response.Content.ReadFromJsonAsync<JsonElement>();
        var cookie = response.Headers.GetValues("Set-Cookie").Single();
        Assert.Contains("secure", cookie); Assert.Contains("httponly", cookie);
        client.DefaultRequestHeaders.Add("Cookie", cookie.Split(';')[0]);
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf.GetProperty("token").GetString());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsJsonAsync("/api/account/login", new { email = "a@b.com", password = "Abcd1234567!" })).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/api/account/google")).StatusCode);
    }

    [Fact]
    public async Task IdentityHashesPasswordsVerifiesEmailAndInvalidatesResetTokens()
    {
        await using var app = BuildApp(true);
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AccountUser>>();
        var user = new AccountUser { Email = "test@example.test", UserName = "test@example.test" };
        Assert.True((await users.CreateAsync(user, "OriginalPassword12!")).Succeeded);
        Assert.NotEqual("OriginalPassword12!", user.PasswordHash);
        Assert.False(user.EmailConfirmed);
        Assert.False((await users.ConfirmEmailAsync(user, "invalid-token")).Succeeded);
        var verification = await users.GenerateEmailConfirmationTokenAsync(user);
        Assert.True((await users.ConfirmEmailAsync(user, verification)).Succeeded);
        var claims = await scope.ServiceProvider.GetRequiredService<IUserClaimsPrincipalFactory<AccountUser>>().CreateAsync(user);
        Assert.Equal(user.Id, claims.FindFirstValue(ClaimTypes.NameIdentifier));
        Assert.True(claims.HasClaim("email_verified", "true"));
        var stamp = user.SecurityStamp;
        var reset = await users.GeneratePasswordResetTokenAsync(user);
        Assert.True((await users.ResetPasswordAsync(user, reset, "ChangedPassword34!")).Succeeded);
        Assert.NotEqual(stamp, user.SecurityStamp);
        Assert.False((await users.ResetPasswordAsync(user, reset, "OtherPassword56!")).Succeeded);
        Assert.False(await users.CheckPasswordAsync(user, "OriginalPassword12!"));
        Assert.True(await users.CheckPasswordAsync(user, "ChangedPassword34!"));
    }

    [Fact]
    public async Task IdentityLocksOutAfterFiveBadPasswordsAndDoesNotAutolinkByEmail()
    {
        await using var app = BuildApp(true);
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AccountUser>>();
        var signIn = scope.ServiceProvider.GetRequiredService<SignInManager<AccountUser>>();
        var user = new AccountUser { Email = "lock@example.test", UserName = "lock@example.test" };
        Assert.True((await users.CreateAsync(user, "OriginalPassword12!")).Succeeded);
        for (var i = 0; i < 5; i++) await signIn.CheckPasswordSignInAsync(user, "bad-password", true);
        Assert.True(await users.IsLockedOutAsync(user));
        Assert.True((await signIn.CheckPasswordSignInAsync(user, "OriginalPassword12!", true)).IsLockedOut);
        Assert.Null(await users.FindByLoginAsync("Google", "provider-subject"));
        Assert.True((await users.AddLoginAsync(user, new UserLoginInfo("Google", "provider-subject", "Google"))).Succeeded);
        Assert.Equal(user.Id, (await users.FindByLoginAsync("Google", "provider-subject"))!.Id);
    }

    [Fact]
    public async Task RegisterVerifyAndResetWorkThroughHttpWithCapturedEmail()
    {
        var capture = new CaptureEmailSender();
        await using var app = BuildApp(true, capture);
        await app.StartAsync();
        using var client = app.GetTestClient();
        client.BaseAddress = new Uri("https://localhost");
        var cookies = new Dictionary<string, string>();
        void RememberCookies(HttpResponseMessage response)
        {
            if (!response.Headers.TryGetValues("Set-Cookie", out var values)) return;
            foreach (var value in values)
            {
                var pair = value.Split(';')[0]; var separator = pair.IndexOf('=');
                cookies[pair[..separator]] = pair[(separator + 1)..];
            }
            client.DefaultRequestHeaders.Remove("Cookie");
            client.DefaultRequestHeaders.Add("Cookie", string.Join("; ", cookies.Select(x => x.Key + "=" + x.Value)));
        }
        async Task RefreshCsrf()
        {
            var response = await client.GetAsync("/api/account/csrf"); RememberCookies(response);
            var token = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
            client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN"); client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", token);
        }
        await RefreshCsrf();
        var register = await client.PostAsJsonAsync("/api/account/register", new { email = "flow@example.test", password = "OriginalPassword12!" });
        Assert.Equal(HttpStatusCode.OK, register.StatusCode); RememberCookies(register);
        var initialStatus = await client.GetFromJsonAsync<JsonElement>("/api/account/me");
        Assert.True(initialStatus.GetProperty("emailEnabled").GetBoolean());
        Assert.False(initialStatus.GetProperty("googleLinked").GetBoolean());
        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AccountUser>>();
            var user = (await users.FindByEmailAsync("flow@example.test"))!;
            Assert.True((await users.AddLoginAsync(user, new UserLoginInfo("Google", "flow-google-subject", "Google"))).Succeeded);
        }
        var linkedStatus = await client.GetFromJsonAsync<JsonElement>("/api/account/me");
        Assert.True(linkedStatus.GetProperty("googleLinked").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/verified")).StatusCode);
        var link = capture.Body!.Split('\n').Single(x => x.StartsWith("https://", StringComparison.Ordinal));
        var query = QueryHelpers.ParseQuery(new Uri(link).Query);
        await RefreshCsrf();
        var verify = await client.PostAsJsonAsync("/api/account/verify", new { userId = query["userId"].ToString(), token = query["token"].ToString() });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode); RememberCookies(verify);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/verified")).StatusCode);
        await RefreshCsrf();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/account/forgot", new { email = "flow@example.test" })).StatusCode);
        var resetLink = capture.Body!.Split('\n').Single(x => x.StartsWith("https://", StringComparison.Ordinal));
        var resetQuery = QueryHelpers.ParseQuery(new Uri(resetLink).Query);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/account/reset", new
        { userId = resetQuery["userId"].ToString(), token = resetQuery["token"].ToString(), password = "ChangedPassword34!" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/verified")).StatusCode);
    }

    private sealed class ReadyDatabase : IAccountDatabase
    { public Task<bool> ReadyAsync(CancellationToken cancellationToken = default) => Task.FromResult(true); }

    [Fact]
    public async Task EmailSenderCanBeReplacedWithoutSendingRealMail()
    {
        var sender = new CaptureEmailSender();
        var mail = new AccountMail(new AccountOptions { PublicOrigin = "https://docnori.com" }, sender);
        await mail.SendAsync(new AccountUser { Id = "user", Email = "a@example.test" }, "a+b/c==", false, default);
        Assert.Contains("https://docnori.com/account/verify?userId=user&token=a%2Bb%2Fc%3D%3D", sender.Body);
        Assert.Equal("a@example.test", sender.Email);
    }
    private sealed class CaptureEmailSender : IAccountEmailSender
    {
        public string? Body { get; private set; }
        public string? Email { get; private set; }
        public Task SendAsync(string email, string subject, string body, CancellationToken cancellationToken)
        { Email = email; Body = body; return Task.CompletedTask; }
    }
}
