using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http.Features;
namespace SabuySign.Host.Features.SigningSessions;

public static class SigningEndpoints
{
    public static void AddSigningSessions(this WebApplicationBuilder builder)
    {
        builder.Services.AddRateLimiter(o => o.AddPolicy("signing", _ => RateLimitPartition.GetFixedWindowLimiter("signing", _ => new() { PermitLimit = 6000, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
        if (string.IsNullOrWhiteSpace(builder.Configuration["SigningSessions:ConnectionString"])) return;
        builder.Services.AddSingleton<SigningStore>();
        builder.Services.AddHostedService<SigningCleanup>();
    }
    private static string Token(HttpRequest r) => r.Headers.Authorization.ToString().Replace("Bearer ", "", StringComparison.Ordinal);
    private static string Participant(HttpRequest r) => r.Headers["X-Participant"].ToString();
    private static async Task<byte[]> Bytes(HttpRequest r, int limit, CancellationToken ct)
    {
        if (r.ContentType != "application/octet-stream") throw new SigningFailure(415);
        var feature = r.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false }) feature.MaxRequestBodySize = limit;
        if (r.ContentLength > limit) throw new SigningFailure(413);
        using var stream = new MemoryStream();
        var buffer = new byte[81920];
        int n;
        while ((n = await r.Body.ReadAsync(buffer, ct)) > 0)
        {
            if (stream.Length + n > limit) throw new SigningFailure(413);
            stream.Write(buffer, 0, n);
        }
        return stream.ToArray();
    }
    public static async Task MapSigningSessions(this WebApplication app)
    {
        var store = app.Services.GetService<SigningStore>();
        app.MapGet("/api/signing/config", () => Results.Ok(new { enabled = store is not null }));
        if (store is null)
        {
            app.MapMethods("/api/signing/{**path}", ["GET", "POST", "DELETE"], () => Results.StatusCode(503));
            return;
        }
        await store.Initialize(CancellationToken.None);
        var group = app.MapGroup("/api/signing").RequireRateLimiting("signing");
        group.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            context.HttpContext.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            try { return await next(context); }
            catch (SigningFailure e) { return Results.StatusCode(e.Status); }
        });
        group.MapPost("/{id:guid}", async (Guid id, HttpRequest r, CancellationToken ct) =>
        {
            await store.Create(id, Token(r), r.Headers["X-Invite-Hash"].ToString(), await Bytes(r, 26214500, ct), ct);
            return Results.StatusCode(201);
        });
        group.MapGet("/{id:guid}/document", async (Guid id, HttpRequest r, CancellationToken ct) => Results.Bytes(await store.Document(id, Token(r), ct), "application/octet-stream"));
        group.MapPost("/{id:guid}/join", async (Guid id, HttpRequest r, CancellationToken ct) => Results.Ok(new { number = await store.Join(id, Token(r), Participant(r), ct) }));
        group.MapPost("/{id:guid}/presence", async (Guid id, Presence body, HttpRequest r, CancellationToken ct) => { await store.Heartbeat(id, Token(r), Participant(r), body.Signing, ct); return Results.NoContent(); });
        group.MapGet("/{id:guid}/state", async (Guid id, HttpRequest r, CancellationToken ct) =>
        {
            // Full authoritative snapshots on reconnect; long polling has no bearer credentials in URLs.
            var previous = r.Headers["X-State-Version"].ToString();
            for (var i = 0; ; i++)
            {
                var state = await store.Snapshot(id, Token(r), ct);
                var stamp = $"{state.Session.Revision}:{string.Join(',', state.Members.Select(m => $"{m.Number}-{m.Signing}-{m.Online}"))}";
                if (stamp != previous || i >= 19)
                {
                    r.HttpContext.Response.Headers["X-State-Version"] = stamp;
                    return Results.Ok(state);
                }
                await Task.Delay(1000, ct);
            }
        });
        group.MapGet("/{id:guid}/batches/{batch:guid}", async (Guid id, Guid batch, HttpRequest r, CancellationToken ct) => Results.Bytes(await store.Batch(id, Token(r), batch, ct), "application/octet-stream"));
        group.MapPost("/{id:guid}/batches/{batch:guid}", async (Guid id, Guid batch, HttpRequest r, CancellationToken ct) => { await store.Submit(id, Token(r), Participant(r), batch, await Bytes(r, 524288, ct), ct); return Results.NoContent(); });
        group.MapPost("/{id:guid}/close", async (Guid id, CloseRequest body, HttpRequest r, CancellationToken ct) => { await store.Close(id, Token(r), body.Revision, ct); return Results.NoContent(); });
        group.MapDelete("/{id:guid}", async (Guid id, HttpRequest r, CancellationToken ct) => { await store.Delete(id, Token(r), ct); return Results.NoContent(); });
    }
    public sealed record Presence(bool Signing);
    public sealed record CloseRequest(int Revision);
}
internal sealed class SigningCleanup(SigningStore store, ILogger<SigningCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await store.Sweep(stoppingToken); }
            catch (Exception e) when (!stoppingToken.IsCancellationRequested) { logger.LogError("Signing expiry cleanup failed: {Type}", e.GetType().Name); }
        }
    }
}
