using Npgsql;
using SabuySign.Host.Features.DocumentTemplates;
using Xunit;

public sealed class DatabaseFactAttribute : FactAttribute
{
    public DatabaseFactAttribute() { if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("TEMPLATES_TEST_DB"))) Skip = "Set TEMPLATES_TEST_DB to an isolated PostgreSQL test database."; }
}
public class TemplateStoreTests
{
    private static byte[] Pdf => File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "plain.pdf"));
    private static TemplateDefinition Definition => new([new("field", "Company", "text", false, "Example")], [new("placement", "field", 0, 20, 20, 100, 40, 16, "#172433", "left", false)]);
    private sealed class Fixture : IAsyncDisposable
    {
        public string Owner { get; } = Guid.NewGuid().ToString();
        public string Other { get; } = Guid.NewGuid().ToString();
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "template-tests-" + Guid.NewGuid().ToString("N"));
        public TemplateStore Store { get; }
        private readonly string connection = Environment.GetEnvironmentVariable("TEMPLATES_TEST_DB")!;
        public Fixture(TemplateLimits? limits = null) => Store = new(connection, new TemplateFileStore(Root, null), limits ?? new());
        public async Task Initialize() => await Store.Initialize(default);
        public async ValueTask DisposeAsync()
        {
            await using var c = new NpgsqlConnection(connection); await c.OpenAsync();
            await using var cmd = new NpgsqlCommand("DELETE FROM document_templates WHERE owner_id=$1 OR owner_id=$2", c);
            cmd.Parameters.AddWithValue(Owner); cmd.Parameters.AddWithValue(Other); await cmd.ExecuteNonQueryAsync();
            await Store.DisposeAsync(); Directory.Delete(Root, true);
        }
    }
    [Theory]
    [InlineData("signed")]
    [InlineData("encrypted")]
    [InlineData("empty-password")]
    public void ProtectedPdfRejected(string name) => Assert.Throws<TemplateFailure>(() => TemplateValidation.Pdf(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", name + ".pdf")), new()));
    [Fact] public void RealPdfAccepted() => Assert.Single(TemplateValidation.Pdf(Pdf, new()));
    [DatabaseFact]
    public async Task AllOperationsEnforceOwnerAndDeleteRevokesAccess()
    {
        await using var f = new Fixture(); await f.Initialize();
        var created = await f.Store.Create(f.Owner, "Private", Pdf, default);
        Assert.Empty(await f.Store.List(f.Other, default));
        var other = f.Other;
        foreach (var operation in new Func<Task>[] {
            async () => { await f.Store.Get(other,created.Id,default); }, async () => {await f.Store.File(other,created.Id,default);},
            async () => { await f.Store.Save(other,created.Id,new("Hacked",1,Definition),default); }, async () => {await f.Store.Duplicate(other,created.Id,default);},
            async () => await f.Store.Delete(other,created.Id,default) })
            Assert.Equal(404, (await Assert.ThrowsAsync<TemplateFailure>(operation)).Status);
        Assert.Equal(Pdf, await f.Store.File(f.Owner, created.Id, default));
        await f.Store.Delete(f.Owner, created.Id, default);
        Assert.Equal(404, (await Assert.ThrowsAsync<TemplateFailure>(() => f.Store.Get(f.Owner, created.Id, default))).Status);
        await f.Store.Cleanup(default); Assert.Empty(Directory.GetFiles(f.Root));
    }
    [DatabaseFact]
    public async Task ConcurrentSaveHasExactlyOneWinnerAndRevisionIsAtomic()
    {
        await using var f = new Fixture(); await f.Initialize();
        var created = await f.Store.Create(f.Owner, "Original", Pdf, default);
        async Task<int> Save(string name) { try { return (await f.Store.Save(f.Owner, created.Id, new(name, 1, Definition), default)).Version; } catch (TemplateFailure e) { return e.Status; } }
        var results = await Task.WhenAll(Save("A"), Save("B")); Assert.Contains(2, results); Assert.Contains(409, results);
        var current = await f.Store.Get(f.Owner, created.Id, default); Assert.Equal(2, current.Version); Assert.Equal("Example", current.Definition.Fields[0].DefaultValue);
        await using var c = new NpgsqlConnection(Environment.GetEnvironmentVariable("TEMPLATES_TEST_DB")); await c.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT count(*) FROM document_template_revisions WHERE template_id=$1", c); cmd.Parameters.AddWithValue(created.Id);
        Assert.Equal(2L, await cmd.ExecuteScalarAsync());
        var copy = await f.Store.Duplicate(f.Owner, created.Id, default); Assert.NotEqual(current.Id, copy.Id); Assert.Equal(1, copy.Version); Assert.NotEqual(current.Definition.Fields[0].Id, copy.Definition.Fields[0].Id);
        Assert.Equal(copy.Definition.Fields[0].Id, copy.Definition.Placements[0].FieldId);
    }
    [DatabaseFact]
    public async Task ConcurrentCreationCannotExceedQuota()
    {
        await using var f = new Fixture(new(MaxTemplates: 1)); await f.Initialize();
        async Task<int> Create() { try { await f.Store.Create(f.Owner, "Quota", Pdf, default); return 201; } catch (TemplateFailure e) { return e.Status; } }
        var results = await Task.WhenAll(Create(), Create()); Assert.Contains(201, results); Assert.Contains(413, results);
        Assert.Single(await f.Store.List(f.Owner, default)); Assert.Single(Directory.GetFiles(f.Root));
    }
    private sealed class RetryFiles(ITemplateFileStore inner) : ITemplateFileStore
    {
        public bool FailDelete { get; set; } = true;
        public Task Write(string key, byte[] bytes, CancellationToken ct) => inner.Write(key, bytes, ct);
        public Task<byte[]> Read(string key, CancellationToken ct) => inner.Read(key, ct);
        public void Delete(string key) { if (FailDelete) throw new IOException("simulated disk outage"); inner.Delete(key); }
        public IEnumerable<string> OldFiles(DateTime before) => inner.OldFiles(before);
    }
    [DatabaseFact]
    public async Task DeletionRetriesAndOrphanCleanupPreservesReferencedFiles()
    {
        var root = Path.Combine(Path.GetTempPath(), "template-retry-" + Guid.NewGuid().ToString("N"));
        var files = new RetryFiles(new TemplateFileStore(root, null));
        await using var store = new TemplateStore(Environment.GetEnvironmentVariable("TEMPLATES_TEST_DB")!, files, new());
        await store.Initialize(default); var owner = Guid.NewGuid().ToString();
        try
        {
            var item = await store.Create(owner, "Keep", Pdf, default);
            var live = Directory.GetFiles(root).Single(); File.SetLastWriteTimeUtc(live, DateTime.UtcNow.AddDays(-2));
            var orphan = Guid.NewGuid().ToString("N"); await files.Write(orphan, Pdf, default); File.SetLastWriteTimeUtc(Path.Combine(root, orphan + ".pdf"), DateTime.UtcNow.AddDays(-2));
            files.FailDelete = false; await store.Cleanup(default); Assert.True(File.Exists(live)); Assert.Single(Directory.GetFiles(root));
            await store.Delete(owner, item.Id, default); files.FailDelete = true; await store.Cleanup(default); Assert.True(File.Exists(live));
            Assert.Equal(404, (await Assert.ThrowsAsync<TemplateFailure>(() => store.File(owner, item.Id, default))).Status);
            files.FailDelete = false; await store.Cleanup(default); Assert.Empty(Directory.GetFiles(root));
        }
        finally { Directory.Delete(root, true); }
    }
    [DatabaseFact]
    public async Task InvalidSaveDoesNotCreateRevisionOrChangeCurrent()
    {
        await using var f = new Fixture(); await f.Initialize(); var created = await f.Store.Create(f.Owner, "Original", Pdf, default);
        await Assert.ThrowsAsync<TemplateFailure>(() => f.Store.Save(f.Owner, created.Id, new("Bad", 1, Definition with { Placements = [Definition.Placements[0] with { Page = 100 }] }), default));
        Assert.Equal(1, (await f.Store.Get(f.Owner, created.Id, default)).Version);
    }
}
