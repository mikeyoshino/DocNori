using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Options;

namespace SabuySign.Host.Features.Accounts;

public sealed class AccountUser : IdentityUser { }
public sealed class AccountDbContext(DbContextOptions<AccountDbContext> options) : IdentityDbContext<AccountUser>(options)
{
    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.HasDefaultSchema("accounts");
    }
}

public sealed class AccountClaimsFactory(UserManager<AccountUser> users, IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<AccountUser>(users, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(AccountUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        identity.AddClaim(new Claim("email_verified", user.EmailConfirmed ? "true" : "false"));
        return identity;
    }
}

// Accounts live in their own schema, so existing application tables never suppress initialization.
// No destructive automatic migrations: future schema changes require reviewed SQL migrations.
public interface IAccountDatabase { Task<bool> ReadyAsync(CancellationToken cancellationToken = default); }

public sealed class AccountDatabase(IServiceScopeFactory scopes, AccountOptions options, ILogger<AccountDatabase> logger) : IAccountDatabase
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private bool initialized;
    public async Task<bool> ReadyAsync(CancellationToken cancellationToken = default)
    {
        if (!options.Available) return false;
        if (initialized) return true;
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (initialized) return true;
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            await db.Database.OpenConnectionAsync(cancellationToken);
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(817362519)", cancellationToken);
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.Transaction = transaction.GetDbTransaction();
            command.CommandText = "SELECT to_regclass('accounts.\"AspNetUsers\"') IS NOT NULL";
            var exists = (bool)(await command.ExecuteScalarAsync(cancellationToken))!;
            if (!exists) await db.Database.ExecuteSqlRawAsync(db.Database.GenerateCreateScript(), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            initialized = true;
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Do not log database exception details: provider messages can include user data.
            logger.LogWarning("Account storage unavailable ({ErrorType})", exception.GetType().Name);
            return false;
        }
        finally { gate.Release(); }
    }
}
