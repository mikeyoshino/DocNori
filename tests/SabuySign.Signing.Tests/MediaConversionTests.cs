using System.Diagnostics;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using SabuySign.Media;
using Xunit;
namespace SabuySign.Signing.Tests;

public class MediaConversionTests
{
    [DatabaseTheory]
    [InlineData(true)]
    public async Task CancellingRunningJobKillsItsEncoderProcess(bool _)
    {
        if (OperatingSystem.IsWindows()) return;
        var root = Path.Combine(Path.GetTempPath(), "media-process-test-" + Guid.NewGuid());
        Directory.CreateDirectory(root);
        var probe = Path.Combine(root, "probe");
        var encoder = Path.Combine(root, "encoder");
        await File.WriteAllTextAsync(probe, "#!/bin/sh\nprintf '%s' '{\"format\":{\"duration\":\"2\"},\"streams\":[{\"codec_type\":\"audio\"}]}'\n");
        await File.WriteAllTextAsync(encoder, "#!/bin/sh\necho $$ > \"$0.pid\"\nexec sleep 60\n");
        File.SetUnixFileMode(probe, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        File.SetUnixFileMode(encoder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["MediaConversion:ConnectionString"] = Environment.GetEnvironmentVariable("SIGNING_TEST_DATABASE"),
            ["MediaConversion:StoragePath"] = Path.Combine(root, "jobs"),
            ["MediaConversion:ffprobe"] = probe,
            ["MediaConversion:ffmpeg"] = encoder
        }).Build();
        var store = new MediaStore(config);
        await store.Initialize(default);
        var id = Guid.NewGuid();
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        Task? running = null;
        try
        {
            await store.Create(id, token, new("mp3", 10), default);
            await store.Upload(id, token, 0, new MemoryStream(new byte[10]), 10, default);
            await store.Act(id, token, "complete", default);
            var job = await store.Claim(default);
            Assert.Equal(id, job!.Id);
            running = new MediaWorker(store, config, NullLogger<MediaWorker>.Instance).Run(job, stop.Token);
            while (!File.Exists(encoder + ".pid")) await Task.Delay(20, stop.Token);
            var pid = int.Parse(await File.ReadAllTextAsync(encoder + ".pid", stop.Token));
            using var process = Process.GetProcessById(pid);
            Assert.False(process.HasExited);
            await store.Act(id, token, "cancel", default);
            await running.WaitAsync(TimeSpan.FromSeconds(8));
            Assert.True(process.HasExited);
            Assert.Equal("cancelled", (await store.Get(id, token, default))!.State);
            await store.Cleanup(default);
            Assert.False(Directory.Exists(store.DirectoryFor(id)));
        }
        finally
        {
            await stop.CancelAsync();
            if (running is not null) await running;
            await store.Act(id, token, "cancel", default);
            await store.Cleanup(default);
            Directory.Delete(root, true);
        }
    }
    [Theory]
    [InlineData(8, 8192, 0, 7)]
    [InlineData(1, 2048, 0, 1)]
    [InlineData(8, 2048, 0, 1)]
    [InlineData(8, 16384, 3, 3)]
    [InlineData(2, 8192, 10, 2)]
    public void WorkerCapacityRespectsCpuMemoryAndConfiguredMaximum(int cpus, long memoryMb, int maximum, int expected)
    {
        Assert.Equal(expected, MediaWorker.Capacity(cpus, memoryMb, maximum, 1024, 256));
    }
    [Fact]
    public void LimitsAreDifferentForGifAndAudio()
    {
        MediaStore.Validate(new("gif", 200_000_000, 0, 30));
        MediaStore.Validate(new("mp3", 500_000_000));
        Assert.Throws<MediaFailure>(() => MediaStore.Validate(new("gif", 200_000_001, 0, 30)));
        Assert.Throws<MediaFailure>(() => MediaStore.Validate(new("mp3", 500_000_001)));
        Assert.Throws<MediaFailure>(() => MediaStore.Validate(new("gif", 20, 0, 30.1)));
        Assert.Throws<MediaFailure>(() => MediaStore.Validate(new("gif", 20, double.NaN, 20)));
        Assert.Throws<MediaFailure>(() => MediaStore.Validate(new("gif", 20, 0, 20, 5000)));
    }
    [DatabaseTheory]
    [InlineData(true)]
    public async Task ChunkRetryClaimsAndLeaseCleanup(bool _)
    {
        var root = Path.Combine(Path.GetTempPath(), "media-tests-" + Guid.NewGuid());
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["MediaConversion:ConnectionString"] = Environment.GetEnvironmentVariable("SIGNING_TEST_DATABASE"),
            ["MediaConversion:StoragePath"] = root
        }).Build();
        var store = new MediaStore(config); await store.Initialize(default);
        var id = Guid.NewGuid(); var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        try
        {
            await store.Create(id, token, new("mp3", 10), default);
            Assert.Null(await store.Get(id, "wrong", default));
            Assert.False(await store.Act(id, "wrong", "cancel", default));
            Assert.False(await store.Act(id, token, "complete", default));
            await Assert.ThrowsAsync<MediaFailure>(() => store.Upload(id, token, 0, new MemoryStream(new byte[5]), 10, default));
            Assert.Equal(10, await store.Upload(id, token, 0, new MemoryStream(new byte[10]), 10, default));
            Assert.Equal(10, await store.Upload(id, token, 0, new MemoryStream(new byte[10]), 10, default));
            Assert.Equal(10, new FileInfo(store.Input(id)).Length);
            Assert.True(await store.Act(id, token, "complete", default));
            var claims = await Task.WhenAll(store.Claim(default), store.Claim(default));
            var job = Assert.Single(claims, j => j?.Id == id)!;
            Assert.True(await store.Renew(job, default));
            Assert.NotNull(await store.PrepareRun(job, default));
            Assert.False(await store.Finish(job with { Run = Guid.NewGuid() }, "bad", null, default));
            Assert.True(await store.Act(id, token, "cancel", default));
            Assert.False(await store.Renew(job, default));
            Assert.False(await store.Finish(job, "bad", null, default));
            await store.Cleanup(default);
            Assert.False(Directory.Exists(store.DirectoryFor(id)));
            Assert.Null(await store.PrepareRun(job, default));
            Assert.False(Directory.Exists(store.DirectoryFor(id)));
            var stale = Guid.NewGuid(); await store.Create(stale, token, new("mp3", 10), default);
            await store.Upload(stale, token, 0, new MemoryStream(new byte[10]), 10, default);
            await using var c = await store.Open(default);
            await using (var cmd = new NpgsqlCommand("UPDATE media_jobs SET touched=now()-interval '121 seconds' WHERE id=$1", c)) { cmd.Parameters.AddWithValue(stale); await cmd.ExecuteNonQueryAsync(); }
            Assert.False(await store.Act(stale, token, "heartbeat", default));
            await store.Cleanup(default); Assert.Equal("expired", (await store.Get(stale, token, default))!.State);
            Assert.False(Directory.Exists(store.DirectoryFor(stale)));
        }
        finally { await store.Act(id, token, "cancel", default); await store.Cleanup(default); if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
