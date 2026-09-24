using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;
using SabuySign.Host.Features.SigningSessions;
using Xunit;
namespace SabuySign.Signing.Tests;

public class SigningSessionTests
{
    [Fact]
    public void CapabilitiesAreStrictAndHashed()
    {
        Assert.False(SigningStore.ValidSecret("owner"));
        var secret = Secret();
        Assert.True(SigningStore.ValidSecret(secret));
        Assert.Equal(64, SigningStore.Hash(secret).Length);
        Assert.NotEqual(SigningStore.Hash(secret), SigningStore.Hash(Secret()));
    }
    [Fact]
    public async Task DisabledWithoutDatabase()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsync($"/api/signing/{Guid.NewGuid()}", new ByteArrayContent(new byte[40]))).StatusCode);
    }
    [DatabaseTheory]
    [InlineData(true)]
    public async Task ConcurrentBatchesOwnerClosureIdempotenceAndExpiry(bool _)
    {
        var database = Environment.GetEnvironmentVariable("SIGNING_TEST_DATABASE")!;
        using var factory = new Factory(database);
        using var owner = factory.CreateClient(); using var guest = factory.CreateClient(); using var stranger = factory.CreateClient();
        var id = Guid.NewGuid(); var ownerToken = Secret(); var invite = Secret();
        owner.DefaultRequestHeaders.Add("Authorization", "Bearer " + ownerToken);
        owner.DefaultRequestHeaders.Add("X-Invite-Hash", SigningStore.Hash(invite));
        guest.DefaultRequestHeaders.Add("Authorization", "Bearer " + invite);
        guest.DefaultRequestHeaders.Add("X-Participant", Secret());
        var path = $"/api/signing/{id}";
        try
        {
            Assert.Equal(HttpStatusCode.Created, (await owner.PostAsync(path, Bytes())).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync(path + "/document")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await guest.GetAsync(path + "/document")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await guest.PostAsync(path + "/join", null)).StatusCode);
            var first = Guid.NewGuid(); var second = Guid.NewGuid();
            var submitted = await Task.WhenAll(guest.PostAsync(path + "/batches/" + first, Bytes()), guest.PostAsync(path + "/batches/" + second, Bytes()));
            Assert.All(submitted, response => Assert.Equal(HttpStatusCode.NoContent, response.StatusCode));
            using var state = JsonDocument.Parse(await owner.GetStringAsync(path + "/state"));
            Assert.Equal(2, state.RootElement.GetProperty("batches").GetArrayLength());
            Assert.Equal(2, state.RootElement.GetProperty("session").GetProperty("revision").GetInt32());
            Assert.Equal(HttpStatusCode.Forbidden, (await guest.PostAsJsonAsync(path + "/close", new { revision = 2 })).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(path + "/close", new { revision = 1 })).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await owner.PostAsJsonAsync(path + "/close", new { revision = 2 })).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await guest.PostAsync(path + "/batches/" + first, Bytes())).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await guest.PostAsync(path + "/batches/" + Guid.NewGuid(), Bytes())).StatusCode);
            using var closed = JsonDocument.Parse(await owner.GetStringAsync(path + "/state"));
            var until = closed.RootElement.GetProperty("session").GetProperty("expiresAt").GetDateTimeOffset();
            Assert.InRange(until - DateTimeOffset.UtcNow, TimeSpan.FromHours(23.9), TimeSpan.FromHours(24.1));
            Assert.Equal(HttpStatusCode.NoContent, (await owner.PostAsJsonAsync(path + "/close", new { revision = 2 })).StatusCode);
            using var again = JsonDocument.Parse(await owner.GetStringAsync(path + "/state"));
            Assert.Equal(until, again.RootElement.GetProperty("session").GetProperty("expiresAt").GetDateTimeOffset());
            Assert.Equal(HttpStatusCode.Forbidden, (await guest.DeleteAsync(path)).StatusCode);
            await using var c = new NpgsqlConnection(database); await c.OpenAsync();
            await using var expire = new NpgsqlCommand("UPDATE signing_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", c);
            expire.Parameters.AddWithValue(id); await expire.ExecuteNonQueryAsync();
            Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(path + "/document")).StatusCode);
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["SigningSessions:ConnectionString"] = database }).Build();
            await using var store = new SigningStore(config); await store.Sweep(default);
            await using var check = new NpgsqlCommand("SELECT count(*) FROM signing_batches WHERE session_id=$1", c); check.Parameters.AddWithValue(id);
            Assert.Equal(0L, await check.ExecuteScalarAsync());
        }
        finally { await owner.DeleteAsync(path); }
    }
    private static string Secret() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static ByteArrayContent Bytes() { var content = new ByteArrayContent(new byte[40]); content.Headers.ContentType = new("application/octet-stream"); return content; }
    private sealed class Factory(string database) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseSetting("SigningSessions:ConnectionString", database);
    }
}

public sealed class DatabaseTheoryAttribute : TheoryAttribute
{
    public DatabaseTheoryAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("SIGNING_TEST_DATABASE")))
            Skip = "Set SIGNING_TEST_DATABASE to run PostgreSQL integration tests.";
    }
}
