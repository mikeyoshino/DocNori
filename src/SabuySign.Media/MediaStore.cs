using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace SabuySign.Media;

public sealed record MediaSpec(string Kind, long Bytes, double Start = 0, double End = 0, int Edge = 480, int Fps = 10, bool Loop = true);
public sealed record MediaJob(Guid Id, string State, MediaSpec Spec, long Received, Guid? Run, string? Error, string? Output);
public sealed class MediaFailure(int status, string message) : Exception(message) { public int Status { get; } = status; }
public sealed class MediaStore
{
    public const int Chunk = 8 * 1024 * 1024;
    private readonly string connection;
    public string Root { get; }
    private readonly int maxJobs;
    private readonly long maxBytes;
    public MediaStore(IConfiguration config)
    {
        connection = config["MediaConversion:ConnectionString"] ?? config["SigningSessions:ConnectionString"] ?? throw new InvalidOperationException("Media connection missing");
        Root = Path.GetFullPath(config["MediaConversion:StoragePath"] ?? "/media");
        maxJobs = config.GetValue("MediaConversion:MaxJobs", 20);
        maxBytes = config.GetValue("MediaConversion:MaxReservedBytes", 4_000_000_000L);
    }
    public string DirectoryFor(Guid id) => Path.Combine(Root, id.ToString("N"));
    public string Input(Guid id) => Path.Combine(DirectoryFor(id), "source.bin");
    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public static void Validate(MediaSpec s)
    {
        if (s.Kind is not ("gif" or "mp3") || s.Bytes <= 0 || s.Bytes > (s.Kind == "gif" ? 200_000_000 : 500_000_000)) throw new MediaFailure(400, "ไฟล์เกินขนาดที่รองรับ");
        if (s.Kind == "gif" && (!double.IsFinite(s.Start) || !double.IsFinite(s.End) || s.Start < 0 || s.End <= s.Start || s.End - s.Start > 30.01 || s.End > 3600 || s.Edge is < 160 or > 720 || s.Fps is not (10 or 20))) throw new MediaFailure(400, "เลือกช่วงไม่เกิน 30 วินาที");
    }
    public async Task<NpgsqlConnection> Open(CancellationToken ct)
    {
        var c = new NpgsqlConnection(connection); await c.OpenAsync(ct); return c;
    }
    public async Task Initialize(CancellationToken ct)
    {
        Directory.CreateDirectory(Root);
        await using var c = await Open(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await using (var gate = new NpgsqlCommand("SELECT pg_advisory_xact_lock(78423102)", c, tx)) await gate.ExecuteNonQueryAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS media_jobs (
              id uuid PRIMARY KEY, capability text NOT NULL, spec jsonb NOT NULL, bytes bigint NOT NULL,
              received bigint NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'uploading',
              created timestamptz NOT NULL DEFAULT now(), touched timestamptz NOT NULL DEFAULT now(),
              run uuid, lease timestamptz, attempts int NOT NULL DEFAULT 0, error text, output text,
              completed timestamptz, cleaned boolean NOT NULL DEFAULT false);
            CREATE INDEX IF NOT EXISTS media_queue ON media_jobs(state,created);
            """, c, tx);
        await cmd.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
    }
    private static MediaJob Read(NpgsqlDataReader r) => new(r.GetGuid(0), r.GetString(1), JsonSerializer.Deserialize<MediaSpec>(r.GetString(2))!, r.GetInt64(3), r.IsDBNull(4) ? null : r.GetGuid(4), r.IsDBNull(5) ? null : r.GetString(5), r.IsDBNull(6) ? null : r.GetString(6));
    private const string Columns = "id,state,spec::text,received,run,error,output";
    public async Task<MediaJob?> Get(Guid id, string token, CancellationToken ct)
    {
        await using var c = await Open(ct); await using var cmd = new NpgsqlCommand($"SELECT {Columns} FROM media_jobs WHERE id=$1 AND capability=$2", c);
        cmd.Parameters.AddWithValue(id); cmd.Parameters.AddWithValue(Hash(token)); await using var r = await cmd.ExecuteReaderAsync(ct); return await r.ReadAsync(ct) ? Read(r) : null;
    }
    public async Task Create(Guid id, string token, MediaSpec spec, CancellationToken ct)
    {
        Validate(spec);
        if (token.Length != 64 || !token.All(Uri.IsHexDigit)) throw new MediaFailure(400, "ลิงก์งานไม่ถูกต้อง");
        await using var c = await Open(ct); await using var tx = await c.BeginTransactionAsync(ct);
        await using (var cmd = new NpgsqlCommand("SELECT pg_advisory_xact_lock(78423101)", c, tx)) await cmd.ExecuteNonQueryAsync(ct);
        await using (var cmd = new NpgsqlCommand("SELECT capability FROM media_jobs WHERE id=$1", c, tx))
        { cmd.Parameters.AddWithValue(id); var existing = await cmd.ExecuteScalarAsync(ct); if (existing is string hash) { if (hash != Hash(token)) throw new MediaFailure(404, "ไม่พบงาน"); return; } }
        await using (var cmd = new NpgsqlCommand("SELECT count(*),coalesce(sum(bytes+134217728),0)::bigint FROM media_jobs WHERE NOT cleaned", c, tx))
        {
            await using var r = await cmd.ExecuteReaderAsync(ct); await r.ReadAsync(ct);
            if (r.GetInt64(0) >= maxJobs || r.GetInt64(1) + spec.Bytes + 134217728 > maxBytes) throw new MediaFailure(429, "มีผู้ใช้งานจำนวนมาก กรุณาลองใหม่ภายหลัง");
        }
        if (new DriveInfo(Root).AvailableFreeSpace < spec.Bytes + 1_000_000_000L) throw new MediaFailure(503, "พื้นที่ประมวลผลไม่พร้อม กรุณาลองใหม่ภายหลัง");
        await using (var cmd = new NpgsqlCommand("INSERT INTO media_jobs(id,capability,spec,bytes) VALUES($1,$2,$3::jsonb,$4)", c, tx))
        { cmd.Parameters.AddWithValue(id); cmd.Parameters.AddWithValue(Hash(token)); cmd.Parameters.AddWithValue(JsonSerializer.Serialize(spec)); cmd.Parameters.AddWithValue(spec.Bytes); await cmd.ExecuteNonQueryAsync(ct); }
        await tx.CommitAsync(ct);
    }
    public async Task<long> Upload(Guid id, string token, long offset, Stream body, long length, CancellationToken ct)
    {
        if (offset < 0 || length <= 0 || length > Chunk) throw new MediaFailure(400, "ส่วนของไฟล์ไม่ถูกต้อง");
        await using var c = await Open(ct); await using var tx = await c.BeginTransactionAsync(ct);
        MediaJob job;
        await using (var cmd = new NpgsqlCommand($"SELECT {Columns} FROM media_jobs WHERE id=$1 AND capability=$2 FOR UPDATE", c, tx))
        { cmd.Parameters.AddWithValue(id); cmd.Parameters.AddWithValue(Hash(token)); await using var r = await cmd.ExecuteReaderAsync(ct); if (!await r.ReadAsync(ct)) throw new MediaFailure(404, "ไม่พบงาน"); job = Read(r); }
        if (job.State != "uploading") throw new MediaFailure(409, "งานนี้ปิดแล้ว");
        if (offset < job.Received) return job.Received; // Acknowledgement lost; already stored chunk is not appended again.
        if (offset != job.Received || length != Math.Min(Chunk, job.Spec.Bytes - offset)) throw new MediaFailure(409, "กรุณาส่งไฟล์ต่อจากส่วนล่าสุด");
        Directory.CreateDirectory(DirectoryFor(id));
        await using (var file = new FileStream(Input(id), FileMode.OpenOrCreate, FileAccess.Write, FileShare.None, 81920, true))
        {
            if (file.Length < job.Received) throw new MediaFailure(409, "ไฟล์ไม่ครบ กรุณาเลือกไฟล์ใหม่");
            file.SetLength(job.Received); file.Position = job.Received;
            var buffer = new byte[81920]; long written = 0; int n;
            while ((n = await body.ReadAsync(buffer, ct)) != 0)
            { written += n; if (written > length) throw new MediaFailure(413, "ไฟล์เกินขนาด"); await file.WriteAsync(buffer.AsMemory(0, n), ct); }
            if (written != length) throw new MediaFailure(400, "ส่งไฟล์ไม่ครบ"); await file.FlushAsync(ct);
        }
        await using (var cmd = new NpgsqlCommand("UPDATE media_jobs SET received=received+$2,touched=now() WHERE id=$1", c, tx))
        { cmd.Parameters.AddWithValue(id); cmd.Parameters.AddWithValue(length); await cmd.ExecuteNonQueryAsync(ct); }
        await tx.CommitAsync(ct); return offset + length;
    }
    public async Task<bool> Act(Guid id, string token, string action, CancellationToken ct)
    {
        var sql = action switch
        {
            "heartbeat" => "UPDATE media_jobs SET touched=now() WHERE id=$1 AND capability=$2 AND state IN ('uploading','queued','running','ready') AND touched>now()-interval '120 seconds'",
            "complete" => "UPDATE media_jobs SET state='queued',touched=now() WHERE id=$1 AND capability=$2 AND state='uploading' AND received=bytes",
            _ => "UPDATE media_jobs SET state='cancelled' WHERE id=$1 AND capability=$2 AND state NOT IN ('cancelled','expired')"
        };
        await using var c = await Open(ct); await using var cmd = new NpgsqlCommand(sql, c); cmd.Parameters.AddWithValue(id); cmd.Parameters.AddWithValue(Hash(token)); return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }
    public async Task<MediaJob?> Claim(CancellationToken ct)
    {
        await using var c = await Open(ct);
        await using var cmd = new NpgsqlCommand($"""
            WITH next AS (SELECT id FROM media_jobs WHERE state='queued' AND touched>now()-interval '120 seconds' ORDER BY created FOR UPDATE SKIP LOCKED LIMIT 1)
            UPDATE media_jobs j SET state='running',run=$1,lease=now()+interval '30 seconds',attempts=attempts+1 FROM next WHERE j.id=next.id
            RETURNING j.id,j.state,j.spec::text,j.received,j.run,j.error,j.output
            """, c);
        cmd.Parameters.AddWithValue(Guid.NewGuid()); await using var r = await cmd.ExecuteReaderAsync(ct); return await r.ReadAsync(ct) ? Read(r) : null;
    }
    public async Task<bool> Renew(MediaJob job, CancellationToken ct)
    {
        await using var c = await Open(ct); await using var cmd = new NpgsqlCommand("UPDATE media_jobs SET lease=now()+interval '30 seconds' WHERE id=$1 AND run=$2 AND state='running' AND lease>now() AND touched>now()-interval '120 seconds'", c);
        cmd.Parameters.AddWithValue(job.Id); cmd.Parameters.AddWithValue(job.Run!.Value); return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }
    public async Task<string?> PrepareRun(MediaJob job, CancellationToken ct)
    {
        await using var c = await Open(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT id FROM media_jobs WHERE id=$1 AND run=$2 AND state='running' AND lease>now() AND touched>now()-interval '120 seconds' FOR UPDATE", c, tx);
        cmd.Parameters.AddWithValue(job.Id);
        cmd.Parameters.AddWithValue(job.Run!.Value);
        if (await cmd.ExecuteScalarAsync(ct) is null) return null;
        // Serialize directory creation with cancellation so a delayed worker cannot recreate deleted files.
        var directory = Path.Combine(DirectoryFor(job.Id), job.Run.Value.ToString("N"));
        Directory.CreateDirectory(directory);
        await tx.CommitAsync(ct);
        return directory;
    }
    public async Task<bool> Finish(MediaJob job, string? output, string? error, CancellationToken ct)
    {
        await using var c = await Open(ct); await using var cmd = new NpgsqlCommand("UPDATE media_jobs SET state=$3,output=$4,error=$5,completed=now() WHERE id=$1 AND run=$2 AND state='running' AND lease>now() AND touched>now()-interval '120 seconds'", c);
        cmd.Parameters.AddWithValue(job.Id); cmd.Parameters.AddWithValue(job.Run!.Value); cmd.Parameters.AddWithValue(output is null ? "failed" : "ready"); cmd.Parameters.AddWithValue((object?)output ?? DBNull.Value); cmd.Parameters.AddWithValue((object?)error ?? DBNull.Value); return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }
    public async Task Cleanup(CancellationToken ct)
    {
        await using var c = await Open(ct);
        await using (var cmd = new NpgsqlCommand("""
            UPDATE media_jobs SET state='expired' WHERE state IN ('uploading','queued','running','ready') AND
              (touched<now()-interval '120 seconds' OR created<now()-interval '2 hours' OR completed<now()-interval '1 hour');
            UPDATE media_jobs SET state=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,error='ประมวลผลไม่สำเร็จ กรุณาเลือกไฟล์ใหม่'
              WHERE state='running' AND lease<now();
            """, c)) await cmd.ExecuteNonQueryAsync(ct);
        var ids = new List<Guid>();
        await using (var cmd = new NpgsqlCommand("SELECT id FROM media_jobs WHERE state IN ('cancelled','expired','failed') AND NOT cleaned", c))
        { await using var r = await cmd.ExecuteReaderAsync(ct); while (await r.ReadAsync(ct)) ids.Add(r.GetGuid(0)); }
        foreach (var id in ids)
        {
            try { if (Directory.Exists(DirectoryFor(id))) Directory.Delete(DirectoryFor(id), true); }
            catch (IOException) { continue; }
            await using var cmd = new NpgsqlCommand("UPDATE media_jobs SET cleaned=true WHERE id=$1 AND state IN ('cancelled','expired','failed')", c); cmd.Parameters.AddWithValue(id); await cmd.ExecuteNonQueryAsync(ct);
        }
        await using (var cmd = new NpgsqlCommand("DELETE FROM media_jobs WHERE cleaned AND created<now()-interval '1 day'", c)) await cmd.ExecuteNonQueryAsync(ct);
    }
}
