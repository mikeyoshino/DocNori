using System.Text.Json;
using Npgsql;

namespace SabuySign.Host.Features.DocumentTemplates;

public sealed class TemplateStore(string connectionString, ITemplateFileStore files, TemplateLimits limits) : IAsyncDisposable
{
    private readonly NpgsqlDataSource source = NpgsqlDataSource.Create(connectionString);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static string Encode<T>(T data) => JsonSerializer.Serialize(data, Json);
    private static T Decode<T>(string data) => JsonSerializer.Deserialize<T>(data, Json)!;
    private static NpgsqlCommand Cmd(NpgsqlConnection c, string sql, params object[] args)
    {
        var cmd = new NpgsqlCommand(sql, c);
        foreach (var arg in args) cmd.Parameters.AddWithValue(arg);
        return cmd;
    }
    public async Task Initialize(CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var cmd = Cmd(c, """
            CREATE TABLE IF NOT EXISTS document_templates (
                id uuid PRIMARY KEY, owner_id text NOT NULL, name text NOT NULL,
                version integer NOT NULL CHECK(version>0), file_key text NOT NULL UNIQUE,
                file_bytes bigint NOT NULL CHECK(file_bytes>0), pages jsonb NOT NULL,
                definition jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
            CREATE INDEX IF NOT EXISTS document_templates_owner ON document_templates(owner_id);
            CREATE TABLE IF NOT EXISTS document_template_revisions (
                template_id uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
                version integer NOT NULL, name text NOT NULL, definition jsonb NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(template_id, version));
            CREATE TABLE IF NOT EXISTS document_template_deletions (file_key text PRIMARY KEY, queued_at timestamptz NOT NULL DEFAULT now());
            """);
        await cmd.ExecuteNonQueryAsync(ct);
    }
    private static async Task LockOwner(NpgsqlConnection c, string owner, CancellationToken ct)
    {
        await using var cmd = Cmd(c, "SELECT pg_advisory_xact_lock(hashtextextended($1, 74329418))", owner);
        await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task<List<TemplateSummary>> List(string owner, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var cmd = Cmd(c, "SELECT id,name,version,updated_at FROM document_templates WHERE owner_id=$1 ORDER BY updated_at DESC,id", owner);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var list = new List<TemplateSummary>();
        while (await r.ReadAsync(ct)) list.Add(new(r.GetGuid(0), r.GetString(1), r.GetInt32(2), r.GetFieldValue<DateTimeOffset>(3)));
        return list;
    }
    private sealed record Stored(TemplateDetail Detail, string Key, long Bytes, TemplatePage[] Pages);
    private static async Task<Stored> Get(NpgsqlConnection c, string owner, Guid id, CancellationToken ct)
    {
        await using var cmd = Cmd(c, "SELECT name,version,definition::text,file_key,file_bytes,pages::text FROM document_templates WHERE id=$1 AND owner_id=$2", id, owner);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) throw new TemplateFailure(404, "ไม่พบแม่แบบ");
        return new(new(id, r.GetString(0), r.GetInt32(1), Decode<TemplateDefinition>(r.GetString(2))), r.GetString(3), r.GetInt64(4), Decode<TemplatePage[]>(r.GetString(5)));
    }
    public async Task<TemplateDetail> Get(string owner, Guid id, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        return (await Get(c, owner, id, ct)).Detail;
    }
    public async Task<byte[]> File(string owner, Guid id, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        return await files.Read((await Get(c, owner, id, ct)).Key, ct);
    }
    public async Task<TemplateDetail> Create(string owner, string name, byte[] bytes, CancellationToken ct)
    {
        var pages = TemplateValidation.Pdf(bytes, limits);
        return await Create(owner, name, bytes, pages, TemplateDefinition.Empty, ct);
    }
    private async Task<TemplateDetail> Create(string owner, string name, byte[] bytes, TemplatePage[] pages, TemplateDefinition definition, CancellationToken ct)
    {
        if (bytes.Length > limits.MaxFileBytes || pages.Length > limits.MaxPages) throw new TemplateFailure(413, "ไฟล์เกินข้อจำกัดปัจจุบัน");
        TemplateValidation.Validate(name, definition, pages, limits);
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await LockOwner(c, owner, ct);
        await using (var quota = Cmd(c, "SELECT count(*),coalesce(sum(file_bytes),0)::bigint FROM document_templates WHERE owner_id=$1", owner))
        {
            await using var r = await quota.ExecuteReaderAsync(ct); await r.ReadAsync(ct);
            if (r.GetInt64(0) >= limits.MaxTemplates || r.GetInt64(1) + bytes.LongLength > limits.MaxAccountBytes) throw new TemplateFailure(413, "พื้นที่หรือจำนวนแม่แบบเกินโควตาบัญชี");
        }
        var id = Guid.NewGuid(); var key = Guid.NewGuid().ToString("N");
        await files.Write(key, bytes, ct);
        // Incomplete/ambiguous transactions leave an orphan for delayed DB-aware cleanup, never delete a possibly committed file here.
        await using (var cmd = Cmd(c, "INSERT INTO document_templates(id,owner_id,name,version,file_key,file_bytes,pages,definition) VALUES($1,$2,$3,1,$4,$5,$6::jsonb,$7::jsonb)", id, owner, name.Trim(), key, bytes.LongLength, Encode(pages), Encode(definition)))
            await cmd.ExecuteNonQueryAsync(ct);
        await Revision(c, id, ct);
        await tx.CommitAsync(ct);
        return new(id, name.Trim(), 1, definition);
    }
    private static async Task Revision(NpgsqlConnection c, Guid id, CancellationToken ct)
    {
        await using var cmd = Cmd(c, "INSERT INTO document_template_revisions(template_id,version,name,definition) SELECT id,version,name,definition FROM document_templates WHERE id=$1", id);
        await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task<TemplateDetail> Save(string owner, Guid id, TemplateSave save, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await LockOwner(c, owner, ct);
        var existing = await Get(c, owner, id, ct);
        if (existing.Detail.Version != save.Version) throw new TemplateFailure(409, "แม่แบบถูกแก้ไขในอีกหน้าต่าง กรุณาเปิดฉบับล่าสุดก่อนบันทึก");
        TemplateValidation.Validate(save.Name, save.Definition, existing.Pages, limits);
        await using (var cmd = Cmd(c, "UPDATE document_templates SET name=$3,version=version+1,definition=$4::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$2 AND version=$5", id, owner, save.Name.Trim(), Encode(save.Definition), save.Version))
            if (await cmd.ExecuteNonQueryAsync(ct) != 1) throw new TemplateFailure(409, "แม่แบบถูกแก้ไข กรุณาเปิดฉบับล่าสุด");
        await Revision(c, id, ct);
        await tx.CommitAsync(ct);
        return new(id, save.Name.Trim(), save.Version + 1, save.Definition);
    }
    public async Task<TemplateDetail> Duplicate(string owner, Guid id, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        var original = await Get(c, owner, id, ct);
        var bytes = await files.Read(original.Key, ct);
        var name = original.Detail.Name.Length > 148 ? original.Detail.Name[..148] : original.Detail.Name;
        return await Create(owner, name + " (สำเนา)", bytes, original.Pages, TemplateValidation.Copy(original.Detail.Definition), ct);
    }
    public async Task Delete(string owner, Guid id, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await LockOwner(c, owner, ct);
        var existing = await Get(c, owner, id, ct);
        await using (var queue = Cmd(c, "INSERT INTO document_template_deletions(file_key) VALUES($1) ON CONFLICT DO NOTHING", existing.Key)) await queue.ExecuteNonQueryAsync(ct);
        await using (var remove = Cmd(c, "DELETE FROM document_templates WHERE id=$1 AND owner_id=$2", id, owner)) await remove.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
        // Metadata revocation is immediate; durable deletion queue survives failures/restarts.
    }
    public async Task Cleanup(CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        var keys = new List<string>();
        await using (var cmd = Cmd(c, "SELECT file_key FROM document_template_deletions LIMIT 1000"))
        {
            await using var r = await cmd.ExecuteReaderAsync(ct); while (await r.ReadAsync(ct)) keys.Add(r.GetString(0));
        }
        foreach (var key in keys)
        {
            try { files.Delete(key); } catch (IOException) { continue; } catch (UnauthorizedAccessException) { continue; }
            await using var done = Cmd(c, "DELETE FROM document_template_deletions WHERE file_key=$1", key); await done.ExecuteNonQueryAsync(ct);
        }
        foreach (var key in files.OldFiles(DateTime.UtcNow.AddDays(-1)))
        {
            ct.ThrowIfCancellationRequested();
            await using var exists = Cmd(c, "SELECT EXISTS(SELECT 1 FROM document_templates WHERE file_key=$1)", key);
            if ((bool)(await exists.ExecuteScalarAsync(ct))!) continue;
            try { files.Delete(key); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
    public ValueTask DisposeAsync() => source.DisposeAsync();
}
