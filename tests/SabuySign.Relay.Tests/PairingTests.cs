using System.Security.Cryptography;
using System.Text;
using SabuySign.Relay.Features.Pairing;
using Xunit;
namespace SabuySign.Relay.Tests;

public class PairingTests
{
    private const string Owner = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private const string Writer = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));
    [Fact]
    public void CapabilitiesAreSeparateAndDuplicateWritesCannotReplaceInk()
    {
        var store = new PairingStore(TimeProvider.System);
        var session = store.Create(Owner, Hash(Writer))!;
        var body = Enumerable.Range(0, 40).Select(x => (byte)x).ToArray();
        Assert.Equal(404, store.Publish(session.Id, Owner, body));
        Assert.Equal(404, store.Read(session.Id, Writer).Status);
        Assert.Equal(204, store.Read(session.Id, Owner).Status);
        Assert.Equal(202, store.Publish(session.Id, Writer, body));
        Assert.Equal(200, store.Publish(session.Id, Writer, body));
        Assert.Equal(409, store.Publish(session.Id, Writer, new byte[40]));
        Assert.Equal(body, store.Read(session.Id, Owner).Body);
        Assert.Equal(204, store.Acknowledge(session.Id, Owner));
        Assert.Equal(410, store.Read(session.Id, Owner).Status);
        Assert.Null(store.Read(session.Id, Owner).Body);
        Assert.Equal("received", store.State(session.Id, Writer));
        Assert.Equal(200, store.Publish(session.Id, Writer, body));
    }
    [Fact]
    public void ExpiryCancellationAndCapacityAreBounded()
    {
        var clock = new Clock(); var store = new PairingStore(clock, 1);
        var session = store.Create(Owner, Hash(Writer))!;
        Assert.Null(store.Create(Owner, Hash(Writer)));
        Assert.Equal(404, store.Cancel(session.Id, Writer));
        clock.Now += TimeSpan.FromMinutes(6);
        Assert.Equal(404, store.Publish(session.Id, Writer, new byte[40]));
        Assert.NotNull(store.Create(Owner, Hash(Writer)));
    }
    [Fact]
    public void InvalidOrOversizedPayloadsNeverBecomeReadable()
    {
        var store = new PairingStore(TimeProvider.System); var session = store.Create(Owner, Hash(Writer))!;
        Assert.Equal(413, store.Publish(session.Id, Writer, new byte[128001]));
        Assert.Equal(400, store.Publish(session.Id, Writer, new byte[1]));
        Assert.Equal(204, store.Read(session.Id, Owner).Status);
        Assert.Equal(204, store.Cancel(session.Id, Owner));
        Assert.Null(store.State(session.Id, Writer));
    }
    private sealed class Clock : TimeProvider { public DateTimeOffset Now = DateTimeOffset.UtcNow; public override DateTimeOffset GetUtcNow() => Now; }
}
