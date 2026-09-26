using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SabuySign.Host.Features.DocumentTemplates;
using Xunit;

public class TemplateStartupTests
{
    [Fact]
    public async Task UnusableVolumeDoesNotThrowDuringResolutionAndRetriesInitialization()
    {
        var path = Path.Combine(Path.GetTempPath(), "template-blocked-" + Guid.NewGuid().ToString("N"));
        await File.WriteAllTextAsync(path, "blocks directory creation");
        try
        {
            var builder = WebApplication.CreateBuilder();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            { ["Accounts:ConnectionString"] = "Host=127.0.0.1;Port=1;Database=test;Username=test;Timeout=1", ["Templates:StoragePath"] = Path.Combine(path, "private") });
            builder.AddDocumentTemplates();
            await using var app = builder.Build();
            var runtime = app.Services.GetRequiredService<TemplateRuntime>();
            await runtime.Initialize(default); Assert.False(runtime.Ready);
            File.Delete(path);
            await runtime.Initialize(default); Assert.False(runtime.Ready); // PostgreSQL deliberately unavailable.
            Assert.True(Directory.Exists(Path.Combine(path, "private"))); // File store was retried successfully.
        }
        finally { if (File.Exists(path)) File.Delete(path); if (Directory.Exists(path)) Directory.Delete(path, true); }
    }
}
