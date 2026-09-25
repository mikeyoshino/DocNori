using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace SabuySign.Media;

public sealed class MediaWorker(MediaStore store, IConfiguration config, ILogger<MediaWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await store.Initialize(stoppingToken);
        var concurrency = Capacity(Environment.ProcessorCount, GC.GetGCMemoryInfo().TotalAvailableMemoryBytes / 1048576,
            config.GetValue("MediaConversion:MaxConcurrency", 0), config.GetValue("MediaConversion:MemoryPerJobMb", 1024),
            config.GetValue("MediaConversion:ReservedMemoryMb", 256));
        logger.LogInformation("Media worker ready with {Concurrency} concurrent slots", concurrency);
        await Task.WhenAll(Enumerable.Range(0, concurrency).Select(_ => Consume(stoppingToken)));
    }
    public static int Capacity(int cpus, long memoryMb, int maximum, int memoryPerJobMb, int reservedMemoryMb)
    {
        var memorySlots = Math.Max(1, (memoryMb - Math.Max(0, reservedMemoryMb)) / Math.Max(256, memoryPerJobMb));
        return (int)Math.Max(1, Math.Min(Math.Min(Math.Max(1, cpus), memorySlots), maximum > 0 ? maximum : 64));
    }
    private async Task Consume(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { var job = await store.Claim(stoppingToken); if (job is not null) await Run(job, stoppingToken); else await Task.Delay(1000, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e) { logger.LogError("Media worker failure: {Type}", e.GetType().Name); await Task.Delay(2000, stoppingToken); }
        }
    }
    public async Task Run(MediaJob job, CancellationToken stop)
    {
        using var run = CancellationTokenSource.CreateLinkedTokenSource(stop); run.CancelAfter(TimeSpan.FromMinutes(5));
        var directory = await store.PrepareRun(job, stop);
        if (directory is null) return;
        var monitor = Task.Run(async () =>
        {
            try { while (!run.IsCancellationRequested) { await Task.Delay(2000, run.Token); if (!await store.Renew(job, run.Token) || DirectoryBytes(directory) > 134217728) { await run.CancelAsync(); break; } } }
            catch (OperationCanceledException) { }
            catch { await run.CancelAsync(); }
        }, CancellationToken.None);
        try
        {
            var input = store.Input(job.Id);
            if (job.Spec.Kind == "word-pdf")
            {
                await using (var source = File.OpenRead(input))
                await using (var copy = File.Create(Path.Combine(directory, "source.bin")))
                    await source.CopyToAsync(copy, run.Token);
                await Process("word-sandbox", [directory, "/usr/bin/python3", "/usr/local/lib/docnori/word_pdf.py", directory], run.Token);
                var pdf = Path.Combine(directory, "document.pdf");
                if (!File.Exists(pdf) || new FileInfo(pdf).Length is < 5 or > 134217728)
                    throw new MediaFailure(400, "สร้าง PDF ไม่สำเร็จ กรุณาตรวจสอบไฟล์ Word");
                if (await store.Finish(job, Path.GetRelativePath(store.DirectoryFor(job.Id), pdf), null, stop)) File.Delete(input);
                return;
            }
            var probe = await Process("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", input], run.Token);
            using var json = JsonDocument.Parse(probe);
            if (!json.RootElement.GetProperty("format").TryGetProperty("duration", out var durationNode) || !double.TryParse(durationNode.GetString(), CultureInfo.InvariantCulture, out var duration) || !double.IsFinite(duration) || duration <= 0 || duration > 3600.1) throw new MediaFailure(400, "วิดีโอต้องยาวไม่เกิน 1 ชั่วโมง");
            var streams = json.RootElement.GetProperty("streams").EnumerateArray().ToArray();
            string name;
            var common = new[] { "-v", "error", "-nostdin", "-y", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm" };
            if (job.Spec.Kind == "mp3")
            {
                if (!streams.Any(s => s.GetProperty("codec_type").GetString() == "audio")) throw new MediaFailure(400, "วิดีโอนี้ไม่มีเสียง ลองเลือกวิดีโออื่น");
                name = "audio.mp3";
                await Process("ffmpeg", [.. common, "-i", input, "-map", "0:a:0", "-vn", "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "128k", "-ac", "2", "-ar", "44100", "-threads", "1", Path.Combine(directory, name)], run.Token);
            }
            else
            {
                if (!streams.Any(s => s.GetProperty("codec_type").GetString() == "video")) throw new MediaFailure(400, "ไม่พบภาพในวิดีโอ");
                if (job.Spec.End > duration + .1) throw new MediaFailure(400, "ช่วงที่เลือกยาวเกินวิดีโอ");
                name = "animation.gif";
                var s = job.Spec; var start = s.Start.ToString(CultureInfo.InvariantCulture); var length = (s.End - s.Start).ToString(CultureInfo.InvariantCulture);
                var filter = $"fps={s.Fps},scale=w='min({s.Edge},iw)':h='min({s.Edge},ih)':force_original_aspect_ratio=decrease:flags=lanczos";
                var palette = Path.Combine(directory, "palette.png");
                await Process("ffmpeg", [.. common, "-ss", start, "-i", input, "-t", length, "-vf", filter + ",palettegen", "-frames:v", "1", "-threads", "1", palette], run.Token);
                // Palette is a trusted, locally generated image; no input demuxer whitelist for this second input.
                await Process("ffmpeg", ["-v", "error", "-nostdin", "-y", "-threads", "1", "-filter_complex_threads", "1", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm", "-ss", start, "-i", input, "-i", palette, "-t", length, "-lavfi", $"[0:v]{filter}[v];[v][1:v]paletteuse", "-an", "-loop", s.Loop ? "0" : "-1", "-threads", "1", Path.Combine(directory, name)], run.Token);
            }
            var output = Path.Combine(directory, name);
            if (!File.Exists(output) || new FileInfo(output).Length is 0 or > 134217728) throw new MediaFailure(400, "ไฟล์ผลลัพธ์ใหญ่เกินไป ลองเลือกช่วงสั้นลง");
            if (await store.Finish(job, Path.GetRelativePath(store.DirectoryFor(job.Id), output), null, stop)) File.Delete(input);
        }
        catch (Exception e)
        {
            if (!stop.IsCancellationRequested) await store.Finish(job, null, job.Spec.Kind == "word-pdf" ? "แปลง Word ไม่สำเร็จ ไฟล์อาจเสียหาย มีรหัสผ่าน หรือมีเนื้อหาที่ไม่รองรับ ลองบันทึกเป็น DOCX ใหม่แล้วเลือกอีกครั้ง" : e is MediaFailure ? e.Message : "แปลงไม่สำเร็จ กรุณาเลือกไฟล์ใหม่หรือลองช่วงสั้นลง", stop);
        }
        finally { await run.CancelAsync(); await monitor; }
    }
    private static long DirectoryBytes(string directory)
    {
        long bytes = 0;
        try
        {
            foreach (var file in new DirectoryInfo(directory).EnumerateFiles("*", new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint }))
            {
                try { bytes += file.Length; }
                catch (FileNotFoundException) { } // Converter temporary files may disappear during a snapshot.
            }
        }
        catch (DirectoryNotFoundException) { } // Cancellation or profile cleanup raced this snapshot.
        return bytes;
    }
    private async Task<string> Process(string tool, string[] args, CancellationToken ct)
    {
        var executable = config[$"MediaConversion:{tool}"] ?? tool;
        using var process = new Process { StartInfo = new ProcessStartInfo(executable) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false } };
        process.StartInfo.Environment.Clear();
        process.StartInfo.Environment["PATH"] = Environment.GetEnvironmentVariable("PATH") ?? "/usr/bin:/bin";
        foreach (var arg in args) process.StartInfo.ArgumentList.Add(arg);
        process.Start();
        using var registration = ct.Register(() => { try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { } });
        var stdout = process.StandardOutput.ReadToEndAsync(ct); var stderr = process.StandardError.ReadToEndAsync(ct);
        try { await process.WaitForExitAsync(ct); var result = await stdout; await stderr; if (process.ExitCode != 0) throw new MediaFailure(400, "อ่านวิดีโอนี้ไม่ได้ ลองเลือกไฟล์ MP4, MOV หรือ WebM อื่น"); return result; }
        finally { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); } }
    }
}
public sealed class MediaCleanup(MediaStore store, ILogger<MediaCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await store.Initialize(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        { try { await store.Cleanup(stoppingToken); } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; } catch (Exception e) { logger.LogError("Media cleanup failure: {Type}", e.GetType().Name); } await Task.Delay(2000, stoppingToken); }
    }
}
