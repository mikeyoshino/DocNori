using System.Threading.RateLimiting;
using SabuySign.Relay.Features.Pairing;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 128000);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<PairingStore>();
builder.Services.AddHostedService<ExpiryService>();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("create", _ => RateLimitPartition.GetFixedWindowLimiter("global", _ => new() { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(_ => RateLimitPartition.GetFixedWindowLimiter("global", _ => new() { PermitLimit = 12000, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    await next(context);
});
app.UseRateLimiter();
static string Token(HttpRequest request)
{
    var auth = request.Headers.Authorization.ToString();
    return auth.StartsWith("Bearer ", StringComparison.Ordinal) ? auth[7..] : "";
}
app.MapPost("/api/pairing", (CreateRequest body, HttpRequest request, PairingStore store) =>
{
    if (!PairingStore.ValidToken(Token(request)) || body.WriterHash is null || body.WriterHash.Length != 64 || !body.WriterHash.All(char.IsAsciiHexDigit)) return Results.BadRequest();
    var pair = store.Create(Token(request), body.WriterHash);
    return pair is null ? Results.StatusCode(503) : Results.Json(pair, statusCode: 201);
}).RequireRateLimiting("create");
app.MapPost("/api/pairing/{id}/signature", async (string id, HttpRequest request, PairingStore store) =>
{
    if (request.ContentType != "application/octet-stream") return Results.StatusCode(415);
    using var body = new MemoryStream();
    var buffer = new byte[8192];
    int count;
    while ((count = await request.Body.ReadAsync(buffer)) > 0)
    {
        if (body.Length + count > 128000) return Results.StatusCode(413);
        body.Write(buffer, 0, count);
    }
    return Results.StatusCode(store.Publish(id, Token(request), body.ToArray()));
});
app.MapGet("/api/pairing/{id}/signature", (string id, HttpRequest request, PairingStore store) =>
{
    var result = store.Read(id, Token(request));
    return result.Body is { } bytes ? Results.Bytes(bytes, "application/octet-stream") : Results.StatusCode(result.Status);
});
app.MapPost("/api/pairing/{id}/ack", (string id, HttpRequest request, PairingStore store) => Results.StatusCode(store.Acknowledge(id, Token(request))));
app.MapDelete("/api/pairing/{id}", (string id, HttpRequest request, PairingStore store) => Results.StatusCode(store.Cancel(id, Token(request))));
app.MapGet("/api/pairing/{id}/state", (string id, HttpRequest request, PairingStore store) => store.State(id, Token(request)) is { } status ? Results.Json(new { status }) : Results.NotFound());
app.Run();
public record CreateRequest(string? WriterHash);
internal sealed class ExpiryService(PairingStore store) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        while (await timer.WaitForNextTickAsync(stoppingToken)) store.Sweep();
    }
}
