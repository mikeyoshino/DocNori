using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Http.Features;
using Npgsql;

namespace SabuySign.Host.Features.DocumentTemplates;

public static class TemplateEndpoints
{
    public static WebApplicationBuilder AddDocumentTemplates(this WebApplicationBuilder builder)
    {
        var config = builder.Configuration;
        int Int(string key, int fallback, int max) => Math.Clamp(config.GetValue<int?>("Templates:" + key) ?? fallback, 1, max);
        var limits = new TemplateLimits(Int("MaxTemplates", 20, 1000), Int("MaxAccountBytes", 100 * 1024 * 1024, int.MaxValue), Int("MaxFileBytes", 25 * 1024 * 1024, 25 * 1024 * 1024), Int("MaxPages", 100, 100), Int("MaxFields", 100, 1000), Int("MaxPlacements", 300, 3000));
        builder.Services.AddSingleton(limits);
        builder.Services.AddSingleton<TemplateRuntime>(services =>
        {
            var connection = config["Accounts:ConnectionString"];
            var path = config["Templates:StoragePath"];
            if (string.IsNullOrWhiteSpace(connection) || string.IsNullOrWhiteSpace(path)) return new(null);
            return new(null, () =>
            {
                var files = new TemplateFileStore(path, builder.Environment.WebRootPath ?? Path.Combine(builder.Environment.ContentRootPath, "wwwroot"));
                return new TemplateStore(connection, files, limits);
            });
        });
        builder.Services.AddHostedService<TemplateCleanupService>();
        return builder;
    }
    public static async Task MapDocumentTemplates(this WebApplication app)
    {
        var runtime = app.Services.GetRequiredService<TemplateRuntime>();
        await runtime.Initialize(app.Lifetime.ApplicationStopping);
        var group = app.MapGroup("/api/templates").RequireAuthorization("AccountsVerified");
        group.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            http.Response.Headers.CacheControl = "no-store";
            http.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            if (!runtime.Ready) return Results.Problem(statusCode: 503, detail: "พื้นที่แม่แบบยังไม่พร้อมใช้งาน กรุณาลองอีกครั้งภายหลัง");
            if (string.IsNullOrWhiteSpace(http.User.FindFirstValue(ClaimTypes.NameIdentifier))) return Results.Unauthorized();
            try
            {
                if (!HttpMethods.IsGet(http.Request.Method))
                {
                    if (string.IsNullOrWhiteSpace(http.Request.Headers["X-CSRF-TOKEN"]))
                        return Results.Problem(statusCode: 400, detail: "เซสชันไม่ถูกต้อง กรุณารีเฟรชแล้วลองอีกครั้ง");
                    await http.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(http);
                }
                return await next(context);
            }
            catch (AntiforgeryValidationException) { return Results.Problem(statusCode: 400, detail: "เซสชันไม่ถูกต้อง กรุณารีเฟรชแล้วลองอีกครั้ง"); }
            catch (TemplateFailure e) { return Results.Problem(statusCode: e.Status, detail: e.Message); }
            catch (JsonException) { return Results.Problem(statusCode: 400, detail: "ข้อมูลแม่แบบไม่ถูกต้อง"); }
            catch (BadHttpRequestException e) { return Results.Problem(statusCode: e.StatusCode, detail: "คำขอไม่ถูกต้องหรือไฟล์มีขนาดเกินข้อจำกัด"); }
            catch (InvalidDataException) { return Results.Problem(statusCode: 400, detail: "ข้อมูลอัปโหลดไม่ถูกต้อง"); }
            catch (NpgsqlException) { return Results.Problem(statusCode: 503, detail: "บันทึกหรืออ่านแม่แบบไม่สำเร็จ กรุณาลองอีกครั้ง"); }
            catch (IOException) { return Results.Problem(statusCode: 503, detail: "พื้นที่จัดเก็บยังไม่พร้อมใช้งาน กรุณาลองอีกครั้ง"); }
            catch (UnauthorizedAccessException) { return Results.Problem(statusCode: 503, detail: "พื้นที่จัดเก็บยังไม่พร้อมใช้งาน กรุณาลองอีกครั้ง"); }
        });
        static string Owner(HttpContext c) => c.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        group.MapGet("/limits", (TemplateLimits limits) => Results.Ok(limits));
        group.MapGet("/", async Task<IResult> (HttpContext c) => Results.Ok(await runtime.Store!.List(Owner(c), c.RequestAborted)));
        group.MapGet("/{id:guid}", async (Guid id, HttpContext c) => Results.Ok(await runtime.Store!.Get(Owner(c), id, c.RequestAborted)));
        group.MapGet("/{id:guid}/file", async (Guid id, HttpContext c) =>
        {
            c.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.File(await runtime.Store!.File(Owner(c), id, c.RequestAborted), "application/pdf", "template.pdf", enableRangeProcessing: false);
        });
        group.MapPost("/", async (HttpContext c, TemplateLimits limits) =>
        {
            var maxBody = (long)limits.MaxFileBytes + 128 * 1024;
            var feature = c.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (feature is { IsReadOnly: false }) feature.MaxRequestBodySize = maxBody;
            if (c.Request.ContentLength > maxBody) throw new TemplateFailure(413, "ไฟล์ใหญ่เกินข้อจำกัด");
            if (!c.Request.HasFormContentType) throw new TemplateFailure(400, "กรุณาเลือกไฟล์ PDF");
            await runtime.UploadGate.WaitAsync(c.RequestAborted);
            try
            {
                var form = await c.Request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = maxBody, ValueLengthLimit = 512, ValueCountLimit = 4, MultipartHeadersLengthLimit = 8192, MemoryBufferThreshold = 65536 }, c.RequestAborted);
                var file = form.Files.GetFile("file");
                if (form.Files.Count != 1 || file is null || file.Length <= 0 || file.Length > limits.MaxFileBytes) throw new TemplateFailure(413, "ขนาดหรือจำนวนไฟล์ไม่ถูกต้อง");
                await using var input = file.OpenReadStream();
                using var memory = new MemoryStream();
                await input.CopyToAsync(memory, c.RequestAborted);
                var detail = await runtime.Store!.Create(Owner(c), form["name"].ToString(), memory.ToArray(), c.RequestAborted);
                return Results.Created($"/api/templates/{detail.Id}", detail);
            }
            finally { runtime.UploadGate.Release(); }
        }).DisableAntiforgery(); // Explicit header validation in the group filter runs before parsing multipart.
        group.MapPut("/{id:guid}", async (Guid id, HttpContext c) =>
        {
            var feature = c.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (feature is { IsReadOnly: false }) feature.MaxRequestBodySize = 2 * 1024 * 1024;
            if (!c.Request.HasJsonContentType()) throw new TemplateFailure(415, "กรุณาส่งข้อมูล JSON");
            var save = await c.Request.ReadFromJsonAsync<TemplateSave>(c.RequestAborted) ?? throw new TemplateFailure(400, "ข้อมูลแม่แบบไม่ถูกต้อง");
            return Results.Ok(await runtime.Store!.Save(Owner(c), id, save, c.RequestAborted));
        });
        group.MapPost("/{id:guid}/duplicate", async (Guid id, HttpContext c) =>
        {
            var detail = await runtime.Store!.Duplicate(Owner(c), id, c.RequestAborted);
            return Results.Created($"/api/templates/{detail.Id}", detail);
        });
        group.MapDelete("/{id:guid}", async (Guid id, HttpContext c) =>
        {
            await runtime.Store!.Delete(Owner(c), id, c.RequestAborted);
            return Results.NoContent();
        });
    }
}
public sealed class TemplateRuntime(TemplateStore? store, Func<TemplateStore>? factory = null) : IAsyncDisposable
{
    public TemplateStore? Store { get; private set; } = store;
    public bool Ready { get; private set; }
    public SemaphoreSlim UploadGate { get; } = new(2);
    public async Task Initialize(CancellationToken ct)
    {
        if (Ready) return;
        try
        {
            Store ??= factory?.Invoke();
            if (Store is null) return;
            await Store.Initialize(ct);
            Ready = true;
        }
        catch (Exception exception) when (exception is NpgsqlException or IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException)
        { /* Invalid configuration and unavailable storage fail closed; background worker retries. */ }
    }
    public async ValueTask DisposeAsync() { if (Store is not null) await Store.DisposeAsync(); UploadGate.Dispose(); }
}
public sealed class TemplateCleanupService(TemplateRuntime runtime, ILogger<TemplateCleanupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await runtime.Initialize(stoppingToken);
                if (runtime.Ready) await runtime.Store!.Cleanup(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch { logger.LogWarning("Template storage maintenance failed; retrying next interval."); }
        }
    }
}
