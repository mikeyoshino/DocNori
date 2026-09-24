using System.Data;
using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace SabuySign.Host.Features.SigningSessions;

public sealed record SigningHeader(Guid Id, bool Closed, DateTimeOffset ExpiresAt, int Revision, bool Owner);
public sealed record SigningMember(int Number, bool Signing, bool Online);
public sealed record SigningBatch(Guid Id, int Member, DateTimeOffset At);
public sealed record SigningSnapshot(SigningHeader Session, List<SigningMember> Members, List<SigningBatch> Batches);
public sealed class SigningFailure(int status) : Exception { public int Status { get; } = status; }

public sealed class SigningStore(IConfiguration configuration) : IAsyncDisposable
{
    private readonly NpgsqlDataSource source = NpgsqlDataSource.Create(configuration["SigningSessions:ConnectionString"]!);
    public static bool ValidSecret(string? token) => token is { Length: 43 } && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
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
            CREATE TABLE IF NOT EXISTS signing_sessions (
              id uuid PRIMARY KEY, owner_hash text NOT NULL, invite_hash text NOT NULL,
              document bytea NOT NULL, closed boolean NOT NULL DEFAULT false,
              expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days', revision integer NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS signing_members (
              session_id uuid REFERENCES signing_sessions ON DELETE CASCADE,
              token_hash text NOT NULL, number integer NOT NULL, signing boolean NOT NULL DEFAULT false,
              seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id, token_hash), UNIQUE(session_id, number));
            CREATE TABLE IF NOT EXISTS signing_batches (
              session_id uuid REFERENCES signing_sessions ON DELETE CASCADE,
              id uuid NOT NULL, member integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
              data bytea NOT NULL, PRIMARY KEY(session_id, id));
            CREATE INDEX IF NOT EXISTS signing_expiry ON signing_sessions(expires_at);
            """);
        await cmd.ExecuteNonQueryAsync(ct);
    }
    private static async Task<SigningHeader> Authorize(NpgsqlConnection c, Guid id, string token, bool locked, CancellationToken ct)
    {
        if (!ValidSecret(token)) throw new SigningFailure(404);
        await using var cmd = Cmd(c, "SELECT closed, expires_at, revision, owner_hash = $2 FROM signing_sessions WHERE id=$1 AND (owner_hash=$2 OR invite_hash=$2) AND expires_at>now()" + (locked ? " FOR UPDATE" : ""), id, Hash(token));
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) throw new SigningFailure(404);
        return new(id, reader.GetBoolean(0), reader.GetFieldValue<DateTimeOffset>(1), reader.GetInt32(2), reader.GetBoolean(3));
    }
    public async Task Create(Guid id, string owner, string inviteHash, byte[] data, CancellationToken ct)
    {
        if (!ValidSecret(owner) || inviteHash.Length != 64 || !inviteHash.All(char.IsAsciiHexDigit) || data.Length is < 29 or > 26214500) throw new SigningFailure(400);
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await using (var gate = Cmd(c, "SELECT pg_advisory_xact_lock(67412249)")) await gate.ExecuteNonQueryAsync(ct);
        await using (var count = Cmd(c, "SELECT count(*) FROM signing_sessions"))
            if ((long)(await count.ExecuteScalarAsync(ct))! >= 100) throw new SigningFailure(503);
        await using var cmd = Cmd(c, "INSERT INTO signing_sessions(id,owner_hash,invite_hash,document) VALUES($1,$2,$3,$4)", id, Hash(owner), inviteHash.ToUpperInvariant(), data);
        try { await cmd.ExecuteNonQueryAsync(ct); }
        catch (PostgresException e) when (e.SqlState == "23505") { throw new SigningFailure(409); }
        await tx.CommitAsync(ct);
    }
    public async Task<byte[]> Document(Guid id, string token, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        await Authorize(c, id, token, false, ct);
        await using var cmd = Cmd(c, "SELECT document FROM signing_sessions WHERE id=$1", id);
        return (byte[])(await cmd.ExecuteScalarAsync(ct))!;
    }
    public async Task<int> Join(Guid id, string token, string participant, CancellationToken ct)
    {
        if (!ValidSecret(participant)) throw new SigningFailure(400);
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        var session = await Authorize(c, id, token, true, ct);
        await using var existing = Cmd(c, "SELECT number FROM signing_members WHERE session_id=$1 AND token_hash=$2", id, Hash(participant));
        if (await existing.ExecuteScalarAsync(ct) is int n) return n;
        if (session.Closed) throw new SigningFailure(409);
        await using var count = Cmd(c, "SELECT count(*) FROM signing_members WHERE session_id=$1", id);
        var number = (int)(long)(await count.ExecuteScalarAsync(ct))! + 1;
        if (number > 50) throw new SigningFailure(429);
        await using var cmd = Cmd(c, "INSERT INTO signing_members(session_id,token_hash,number) VALUES($1,$2,$3)", id, Hash(participant), number);
        await cmd.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
        return number;
    }
    public async Task<SigningSnapshot> Snapshot(Guid id, string token, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var session = await Authorize(c, id, token, false, ct);
        var members = new List<SigningMember>();
        await using (var cmd = Cmd(c, "SELECT number,signing AND seen_at>now()-interval '35 seconds',seen_at>now()-interval '35 seconds' FROM signing_members WHERE session_id=$1 ORDER BY number", id))
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) members.Add(new(reader.GetInt32(0), reader.GetBoolean(1), reader.GetBoolean(2)));
        var batches = new List<SigningBatch>();
        await using (var cmd = Cmd(c, "SELECT id,member,created_at FROM signing_batches WHERE session_id=$1 ORDER BY created_at,id", id))
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) batches.Add(new(reader.GetGuid(0), reader.GetInt32(1), reader.GetFieldValue<DateTimeOffset>(2)));
        return new(session, members, batches);
    }
    public async Task<byte[]> Batch(Guid id, string token, Guid batch, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        await Authorize(c, id, token, false, ct);
        await using var cmd = Cmd(c, "SELECT data FROM signing_batches WHERE session_id=$1 AND id=$2", id, batch);
        return await cmd.ExecuteScalarAsync(ct) as byte[] ?? throw new SigningFailure(404);
    }
    public async Task Heartbeat(Guid id, string token, string participant, bool signing, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        var session = await Authorize(c, id, token, false, ct);
        await using var cmd = Cmd(c, "UPDATE signing_members SET seen_at=now(), signing=$3 WHERE session_id=$1 AND token_hash=$2", id, Hash(participant), signing && !session.Closed);
        if (await cmd.ExecuteNonQueryAsync(ct) == 0) throw new SigningFailure(404);
    }
    public async Task Submit(Guid id, string token, string participant, Guid batch, byte[] data, CancellationToken ct)
    {
        if (data.Length is < 29 or > 524288) throw new SigningFailure(400);
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        var session = await Authorize(c, id, token, true, ct);
        await using var member = Cmd(c, "SELECT number FROM signing_members WHERE session_id=$1 AND token_hash=$2", id, Hash(participant));
        if (await member.ExecuteScalarAsync(ct) is not int number) throw new SigningFailure(404);
        await using (var existing = Cmd(c, "SELECT member,data FROM signing_batches WHERE session_id=$1 AND id=$2", id, batch))
        await using (var reader = await existing.ExecuteReaderAsync(ct))
            if (await reader.ReadAsync(ct))
            {
                if (reader.GetInt32(0) != number || !((byte[])reader[1]).SequenceEqual(data)) throw new SigningFailure(409);
                return; // Lost responses can be retried even after owner closure.
            }
        if (session.Closed || session.Revision >= 200) throw new SigningFailure(409);
        await using (var insert = Cmd(c, "INSERT INTO signing_batches(session_id,id,member,data) VALUES($1,$2,$3,$4)", id, batch, number, data)) await insert.ExecuteNonQueryAsync(ct);
        await using (var update = Cmd(c, "UPDATE signing_sessions SET revision=revision+1 WHERE id=$1", id)) await update.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
    }
    public async Task Close(Guid id, string token, int revision, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        var session = await Authorize(c, id, token, true, ct);
        if (!session.Owner) throw new SigningFailure(403);
        if (session.Closed) return; // Do not extend retention on replay.
        if (session.Revision != revision || revision == 0) throw new SigningFailure(409);
        await using var cmd = Cmd(c, "UPDATE signing_sessions SET closed=true,expires_at=now()+interval '24 hours',revision=revision+1 WHERE id=$1", id);
        await cmd.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
    }
    public async Task Delete(Guid id, string token, CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        if (!(await Authorize(c, id, token, true, ct)).Owner) throw new SigningFailure(403);
        await using var cmd = Cmd(c, "DELETE FROM signing_sessions WHERE id=$1", id);
        await cmd.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
    }
    public async Task Sweep(CancellationToken ct)
    {
        await using var c = await source.OpenConnectionAsync(ct);
        await using var cmd = Cmd(c, "DELETE FROM signing_sessions WHERE expires_at<=now()");
        await cmd.ExecuteNonQueryAsync(ct);
    }
    public ValueTask DisposeAsync() => source.DisposeAsync();
}
