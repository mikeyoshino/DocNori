using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SabuySign.Media;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddSingleton<MediaStore>();
builder.Services.AddHostedService<MediaCleanup>();
builder.Services.AddHostedService<MediaWorker>();
await builder.Build().RunAsync();
