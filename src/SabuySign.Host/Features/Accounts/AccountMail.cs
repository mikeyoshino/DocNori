using System.Net;
using System.Net.Mail;
using Microsoft.AspNetCore.WebUtilities;
namespace SabuySign.Host.Features.Accounts;

public interface IAccountEmailSender
{
    Task SendAsync(string email, string subject, string body, CancellationToken cancellationToken);
}
public sealed class SmtpAccountEmailSender(AccountOptions options) : IAccountEmailSender
{
    public async Task SendAsync(string email, string subject, string body, CancellationToken cancellationToken)
    {
        using var smtp = new SmtpClient(options.Smtp.Host, options.Smtp.Port) { EnableSsl = true };
        if (!string.IsNullOrWhiteSpace(options.Smtp.User))
            smtp.Credentials = new NetworkCredential(options.Smtp.User, options.Smtp.Password);
        using var message = new MailMessage(options.Smtp.From!, email, subject, body);
        await smtp.SendMailAsync(message, cancellationToken);
    }
}
public sealed class AccountMail(AccountOptions options, IAccountEmailSender sender)
{
    public Task SendAsync(AccountUser user, string token, bool reset, CancellationToken cancellationToken)
    {
        var path = reset ? "/account/reset" : "/account/verify";
        var url = QueryHelpers.AddQueryString(options.PublicOrigin!.TrimEnd('/') + path,
            new Dictionary<string, string?> { ["userId"] = user.Id, ["token"] = token });
        return sender.SendAsync(user.Email!, reset ? "Reset your DocNori password" : "Verify your DocNori email",
            $"Open this link to {(reset ? "reset your password" : "verify your email")}:\n{url}\n\nIf you did not request this, ignore this email.", cancellationToken);
    }
}
