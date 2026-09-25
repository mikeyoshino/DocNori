using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http.Features;
using SabuySign.Media;
namespace SabuySign.Host.Features.MediaConversion;

public static class MediaEndpoints
{
    public static void AddMedia(this WebApplicationBuilder builder)
    {
        if (!builder.Configuration.GetValue<bool>("MediaConversion:Enabled")) return;
        builder.Services.AddRateLimiter(o =>
        {
            o.AddPolicy("media", _ => RateLimitPartition.GetFixedWindowLimiter("media", _ => new() { PermitLimit = 1200, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            o.AddPolicy("media-create", _ => RateLimitPartition.GetFixedWindowLimiter("media-create", _ => new() { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
        builder.Services.AddSingleton<MediaStore>();
        builder.Services.AddHostedService<MediaCleanup>();
    }
    private static string Token(HttpRequest r) => r.Headers.Authorization.ToString().Replace("Bearer ", "", StringComparison.Ordinal);
    public static async Task MapMedia(this WebApplication app)
    {
        var store = app.Services.GetService<MediaStore>();
        app.MapGet("/api/media/config", () => Results.Ok(new { enabled = store is not null }));
        if (store is null) { app.MapMethods("/api/media/{**path}", ["GET", "POST", "PUT"], () => Results.Json(new { error = "บริการแปลงไฟล์ยังไม่พร้อม กรุณาลองใหม่ภายหลัง" }, statusCode: 503)); return; }
        await store.Initialize(CancellationToken.None);
        var g = app.MapGroup("/api/media").RequireRateLimiting("media");
        g.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            context.HttpContext.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            try { return await next(context); } catch (MediaFailure e) { return Results.Json(new { error = e.Message }, statusCode: e.Status); }
        });
        g.MapPost("/{id:guid}", async (Guid id, MediaSpec spec, HttpRequest r, CancellationToken ct) => { await store.Create(id, Token(r), spec, ct); return Results.Ok(new { chunkSize = MediaStore.Chunk }); }).RequireRateLimiting("media-create");
        g.MapPut("/{id:guid}/chunks", async (Guid id, long offset, HttpRequest r, CancellationToken ct) =>
        {
            if (r.ContentType != "application/octet-stream") return Results.StatusCode(415);
            var f = r.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>(); if (f is { IsReadOnly: false }) f.MaxRequestBodySize = MediaStore.Chunk;
            return Results.Ok(new { received = await store.Upload(id, Token(r), offset, r.Body, r.ContentLength ?? -1, ct) });
        });
        g.MapPost("/{id:guid}/complete", async (Guid id, HttpRequest r, CancellationToken ct) => await store.Act(id, Token(r), "complete", ct) ? Results.Ok() : Results.StatusCode(409));
        g.MapPost("/{id:guid}/heartbeat", async (Guid id, HttpRequest r, CancellationToken ct) => await store.Act(id, Token(r), "heartbeat", ct) ? Results.Ok() : Results.StatusCode(410));
        g.MapPost("/{id:guid}/leave", async (Guid id, HttpRequest r, CancellationToken ct) =>
        {
            if (r.ContentLength is null or > 128) return Results.BadRequest();
            using var reader = new StreamReader(r.Body); var token = await reader.ReadToEndAsync(ct);
            await store.Act(id, token, "cancel", ct); return Results.NoContent();
        });
        g.MapGet("/{id:guid}", async (Guid id, HttpRequest r, CancellationToken ct) =>
        {
            var job = await store.Get(id, Token(r), ct); return job is null ? Results.NotFound() : Results.Ok(new { state = job.State, received = job.Received, error = job.Error });
        });
        g.MapGet("/{id:guid}/result", async (Guid id, HttpRequest r, CancellationToken ct) =>
        {
            var job = await store.Get(id, Token(r), ct); if (job is null) return Results.NotFound(); if (job.State != "ready" || job.Output is null) return Results.StatusCode(409);
            var path = Path.Combine(store.DirectoryFor(id), job.Output); if (!File.Exists(path)) return Results.NotFound();
            return Results.File(path, job.Spec.Kind == "word-pdf" ? "application/pdf" : job.Spec.Kind == "gif" ? "image/gif" : "audio/mpeg", enableRangeProcessing: true);
        });
    }
}
