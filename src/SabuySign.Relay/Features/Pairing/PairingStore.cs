using System.Security.Cryptography;
using System.Text;

namespace SabuySign.Relay.Features.Pairing;

public record PairingSession(string Id, DateTimeOffset ExpiresAt);
public record ReadResult(int Status, byte[]? Body = null);
public sealed class PairingStore(TimeProvider time, int capacity = 100)
{
    private readonly object gate = new();
    private readonly Dictionary<string, Entry> entries = [];
    private sealed class Entry(byte[] owner, byte[] writer, DateTimeOffset expires)
    {
        public byte[] Owner { get; } = owner;
        public byte[] Writer { get; } = writer;
        public DateTimeOffset Expires { get; } = expires;
        public byte[]? Payload { get; set; }
        public byte[]? Digest { get; set; }
        public bool Received { get; set; }
    }
    public static bool ValidToken(string token) => token.Length == 43 && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    private static byte[] Hash(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));
    private static bool Matches(string token, byte[] digest) => ValidToken(token) && CryptographicOperations.FixedTimeEquals(Hash(token), digest);
    public void Sweep()
    {
        lock (gate)
        {
            foreach (var key in entries.Where(e => e.Value.Expires <= time.GetUtcNow()).Select(e => e.Key).ToArray()) Remove(key);
        }
    }
    private void Remove(string id)
    {
        if (entries.Remove(id, out var entry) && entry.Payload is { } bytes) CryptographicOperations.ZeroMemory(bytes);
    }
    public PairingSession? Create(string owner, string writerHash)
    {
        lock (gate)
        {
            Sweep();
            if (!ValidToken(owner) || writerHash.Length != 64 || !writerHash.All(char.IsAsciiHexDigit) || entries.Count >= capacity) return null;
            var id = Guid.NewGuid().ToString("N");
            var expires = time.GetUtcNow().AddMinutes(5);
            entries.Add(id, new(Hash(owner), Convert.FromHexString(writerHash), expires));
            return new(id, expires);
        }
    }
    private Entry? Find(string id, string token, bool writer = false)
    {
        Sweep();
        return entries.TryGetValue(id, out var e) && Matches(token, writer ? e.Writer : e.Owner) ? e : null;
    }
    public int Publish(string id, string token, byte[] bytes)
    {
        lock (gate)
        {
            var entry = Find(id, token, true);
            if (entry is null) return 404;
            if (bytes.Length > 128000) return 413;
            if (bytes.Length < 29) return 400;
            var digest = SHA256.HashData(bytes);
            if (entry.Digest is { } existing) return CryptographicOperations.FixedTimeEquals(existing, digest) ? 200 : 409;
            entry.Payload = bytes.ToArray();
            entry.Digest = digest;
            return 202;
        }
    }
    public ReadResult Read(string id, string token)
    {
        lock (gate)
        {
            var e = Find(id, token);
            return e is null ? new(404) : e.Received ? new(410) : e.Payload is null ? new(204) : new(200, e.Payload.ToArray());
        }
    }
    public int Acknowledge(string id, string token)
    {
        lock (gate)
        {
            var e = Find(id, token);
            if (e is null) return 404;
            if (e.Digest is null) return 409;
            if (e.Payload is { } bytes) CryptographicOperations.ZeroMemory(bytes);
            e.Payload = null;
            e.Received = true;
            return 204;
        }
    }
    public int Cancel(string id, string token)
    {
        lock (gate)
        {
            if (Find(id, token) is null) return 404;
            Remove(id);
            return 204;
        }
    }
    public string? State(string id, string token)
    {
        lock (gate)
        {
            var e = Find(id, token, true);
            return e is null ? null : e.Received ? "received" : e.Payload is null ? "waiting" : "sent";
        }
    }
}
