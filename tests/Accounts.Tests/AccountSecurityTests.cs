using SabuySign.Host.Features.Accounts;
using Xunit;
namespace Accounts.Tests;

public class AccountSecurityTests
{
    [Theory]
    [InlineData("https://evil.test")]
    [InlineData("//evil.test")]
    [InlineData("/\\evil.test")]
    [InlineData("/\r\nevil")]
    [InlineData("/%2f%2fevil.test")]
    public void ExternalRedirectsAreRejected(string value) => Assert.Equal("/workspace/templates", AccountSecurity.LocalReturnUrl(value));
    [Fact]
    public void LocalRedirectAllowed() => Assert.Equal("/workspace/templates?sort=name", AccountSecurity.LocalReturnUrl("/workspace/templates?sort=name"));
    [Theory]
    [InlineData("http://example.test")]
    [InlineData("https://example.test/path")]
    [InlineData("https://user:pass@example.test")]
    public void PublicOriginRejectsUnsafeConfiguration(string value) => Assert.False(AccountSecurity.IsPublicOrigin(value));
    [Fact]
    public void HttpsOriginAccepted() => Assert.True(AccountSecurity.IsPublicOrigin("https://docnori.com"));
}
