using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace SabuySign.Host.Features.Accounts;

public static class AccountExtensions
{
    public static void AddAccounts(this WebApplicationBuilder builder)
    {
        // Default request-start logging includes query strings containing verification/reset tokens.
        builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
        builder.Logging.AddFilter("Microsoft.AspNetCore.Authentication", LogLevel.Warning);
        var options = builder.Configuration.GetSection("Accounts").Get<AccountOptions>() ?? new();
        builder.Services.AddSingleton(options);
        builder.Services.AddSingleton<IAccountDatabase, AccountDatabase>();
        builder.Services.AddScoped<AccountMail>();
        builder.Services.AddScoped<IAccountEmailSender, SmtpAccountEmailSender>();
        builder.Services.AddDbContext<AccountDbContext>(db => db.UseNpgsql(options.ConnectionString
            ?? "Host=localhost;Database=accounts_disabled;Timeout=2"));
        builder.Services.AddIdentity<AccountUser, IdentityRole>(identity =>
        {
            identity.User.RequireUniqueEmail = true;
            identity.Password.RequiredLength = 12;
            identity.Lockout.MaxFailedAccessAttempts = 5;
            identity.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
            // Unverified users can sign in to resend verification, but cannot access templates.
            identity.SignIn.RequireConfirmedEmail = false;
        }).AddEntityFrameworkStores<AccountDbContext>().AddDefaultTokenProviders()
            .AddClaimsPrincipalFactory<AccountClaimsFactory>();
        builder.Services.Configure<DataProtectionTokenProviderOptions>(token => token.TokenLifespan = TimeSpan.FromHours(1));
        builder.Services.Configure<SecurityStampValidatorOptions>(stamp => stamp.ValidationInterval = TimeSpan.Zero);
        builder.Services.ConfigureApplicationCookie(cookie =>
        {
            cookie.Cookie.Name = "__Host-DocNori.Account";
            cookie.Cookie.HttpOnly = true;
            cookie.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            cookie.Cookie.SameSite = SameSiteMode.Lax;
            cookie.ExpireTimeSpan = TimeSpan.FromHours(12);
            cookie.SlidingExpiration = true;
            cookie.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
            cookie.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
            cookie.Events.OnValidatePrincipal = async context =>
            {
                if (!await context.HttpContext.RequestServices.GetRequiredService<IAccountDatabase>().ReadyAsync(context.HttpContext.RequestAborted))
                { context.RejectPrincipal(); return; }
                try { await SecurityStampValidator.ValidatePrincipalAsync(context); }
                catch (Exception exception) when (exception is Npgsql.NpgsqlException or DbUpdateException)
                { context.RejectPrincipal(); }
            };
        });
        builder.Services.ConfigureExternalCookie(cookie =>
        {
            cookie.Cookie.Name = "__Host-DocNori.External";
            cookie.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            cookie.Cookie.HttpOnly = true;
            cookie.Cookie.SameSite = SameSiteMode.Lax;
            cookie.ExpireTimeSpan = TimeSpan.FromMinutes(5);
        });
        builder.Services.AddAntiforgery(csrf =>
        {
            csrf.HeaderName = "X-CSRF-TOKEN";
            csrf.Cookie.Name = "__Host-DocNori.Csrf";
            csrf.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            csrf.Cookie.HttpOnly = true;
            csrf.Cookie.SameSite = SameSiteMode.Strict;
        });
        builder.Services.AddAuthorization(auth => auth.AddPolicy("AccountsVerified", policy =>
            policy.RequireAuthenticatedUser().RequireClaim("email_verified", "true")));
        builder.Services.AddRateLimiter(limiter =>
        {
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            limiter.AddPolicy("accounts", context => RateLimitPartition.GetFixedWindowLimiter(
                context.User.Identity?.IsAuthenticated == true && context.User.FindFirstValue(ClaimTypes.NameIdentifier) is { } userId
                    ? "user:" + userId : "ip:" + (context.Connection.RemoteIpAddress?.ToString() ?? "unknown"), _ =>
                new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
        if (options.GoogleEnabled)
            builder.Services.AddAuthentication().AddOAuth("Google", oauth =>
            {
                oauth.SignInScheme = IdentityConstants.ExternalScheme;
                oauth.ClientId = options.Google.ClientId!;
                oauth.ClientSecret = options.Google.ClientSecret!;
                oauth.CallbackPath = "/signin-google";
                oauth.AuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
                oauth.TokenEndpoint = "https://oauth2.googleapis.com/token";
                oauth.UserInformationEndpoint = "https://www.googleapis.com/oauth2/v3/userinfo";
                oauth.UsePkce = true;
                oauth.SaveTokens = false;
                oauth.Scope.Add("openid"); oauth.Scope.Add("email"); oauth.Scope.Add("profile");
                oauth.ClaimActions.MapJsonKey(ClaimTypes.NameIdentifier, "sub");
                oauth.ClaimActions.MapJsonKey(ClaimTypes.Email, "email");
                oauth.ClaimActions.MapJsonKey("google_email_verified", "email_verified");
                oauth.CorrelationCookie.SecurePolicy = CookieSecurePolicy.Always;
                oauth.Events.OnCreatingTicket = async context =>
                {
                    using var request = new HttpRequestMessage(HttpMethod.Get, context.Options.UserInformationEndpoint);
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", context.AccessToken);
                    using var response = await context.Backchannel.SendAsync(request, context.HttpContext.RequestAborted);
                    response.EnsureSuccessStatusCode();
                    using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(context.HttpContext.RequestAborted));
                    context.RunClaimActions(json.RootElement);
                };
                oauth.Events.OnRemoteFailure = context =>
                { context.HandleResponse(); context.Response.Redirect("/account/login?error=google_failed"); return Task.CompletedTask; };
            });
    }

    // Only use behind HTTPS ingress with the application port inaccessible to public clients.
    // A fixed operator-controlled origin avoids trusting client-supplied proxy headers.
    public static void UseAccountsOrigin(this WebApplication app)
    {
        var options = app.Services.GetRequiredService<AccountOptions>();
        if (!AccountSecurity.IsPublicOrigin(options.PublicOrigin)) return;
        var origin = new Uri(options.PublicOrigin!);
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path;
            if (path.StartsWithSegments("/api/account") || path.StartsWithSegments("/api/templates") || path == "/signin-google")
            {
                context.Request.Scheme = origin.Scheme;
                context.Request.Host = origin.IsDefaultPort
                    ? new HostString(origin.Host)
                    : new HostString(origin.Host, origin.Port);
            }
            await next();
        });
    }

    public static void MapAccounts(this WebApplication app)
    {
        var group = app.MapGroup("/api/account").RequireRateLimiting("accounts");
        group.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            http.Response.Headers.CacheControl = "no-store";
            http.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            if (!HttpMethods.IsGet(http.Request.Method) && !HttpMethods.IsHead(http.Request.Method))
            {
                try { await http.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(http); }
                catch (AntiforgeryValidationException) { return Error("Invalid security token. Refresh and try again.", 400); }
            }
            if (http.Request.Path != "/api/account/me" && http.Request.Path != "/api/account/csrf"
                && !await http.RequestServices.GetRequiredService<IAccountDatabase>().ReadyAsync(http.RequestAborted))
                return Error("Accounts are temporarily unavailable.", 503);
            try { return await next(context); }
            catch (Exception exception) when (exception is System.Net.Mail.SmtpException or Npgsql.NpgsqlException or DbUpdateException)
            { return Error("Accounts are temporarily unavailable. Please try again.", 503); }
        });
        group.MapGet("/me", async (HttpContext http, IAccountDatabase database, AccountOptions options, UserManager<AccountUser> users) =>
        {
            var available = await database.ReadyAsync(http.RequestAborted);
            var authenticated = available && http.User.Identity?.IsAuthenticated == true;
            var user = authenticated ? await users.GetUserAsync(http.User) : null;
            var googleLinked = user is not null && (await users.GetLoginsAsync(user)).Any(login => login.LoginProvider == "Google");
            return Results.Ok(new
            {
                authenticated,
                email = http.User.FindFirstValue(ClaimTypes.Email),
                verified = available && http.User.HasClaim("email_verified", "true"),
                googleEnabled = available && options.GoogleEnabled,
                emailEnabled = available && options.EmailEnabled,
                googleLinked,
                available
            });
        });
        group.MapGet("/csrf", (HttpContext http, IAntiforgery csrf) => Results.Ok(new { token = csrf.GetAndStoreTokens(http).RequestToken }));
        group.MapPost("/register", Register);
        group.MapPost("/login", Login);
        group.MapPost("/logout", async (SignInManager<AccountUser> signIn) => { await signIn.SignOutAsync(); return Results.Ok(new { success = true }); });
        group.MapPost("/forgot", Forgot);
        group.MapPost("/reset", Reset);
        group.MapPost("/verify", Verify);
        group.MapPost("/resend", Resend).RequireAuthorization();
        group.MapGet("/google", Google);
        group.MapPost("/google/link", LinkGoogle).RequireAuthorization("AccountsVerified");
        group.MapGet("/google/complete", CompleteGoogle);
    }

    private static IResult Error(string error, int status = 400) => Results.Json(new { error }, statusCode: status);
    private static IResult Success() => Results.Ok(new { success = true });
    private static bool ValidCredentials(Credentials input) => !string.IsNullOrWhiteSpace(input.Email)
        && input.Email.Length <= 254 && !string.IsNullOrEmpty(input.Password) && input.Password.Length <= 256;

    private static async Task<IResult> Register(Credentials input, UserManager<AccountUser> users,
        SignInManager<AccountUser> signIn, AccountOptions options, AccountMail mail, HttpContext http)
    {
        if (!options.EmailEnabled) return Error("Email registration is not configured.", 503);
        if (!ValidCredentials(input)) return Error("Enter a valid email and a password of 12–256 characters.");
        var email = input.Email.Trim();
        var user = new AccountUser { UserName = email, Email = email };
        var result = await users.CreateAsync(user, input.Password);
        if (!result.Succeeded) return Error("Unable to register. Use a unique email and a password with 12+ characters, uppercase, lowercase, number and symbol.");
        await signIn.SignInAsync(user, isPersistent: false);
        await mail.SendAsync(user, await users.GenerateEmailConfirmationTokenAsync(user), false, http.RequestAborted);
        return Success();
    }

    private static async Task<IResult> Login(Credentials input, UserManager<AccountUser> users, SignInManager<AccountUser> signIn)
    {
        if (!ValidCredentials(input)) return Error("Invalid email or password.", 401);
        var user = await users.FindByEmailAsync(input.Email.Trim());
        if (user is null) return Error("Invalid email or password.", 401);
        var result = await signIn.PasswordSignInAsync(user, input.Password, isPersistent: false, lockoutOnFailure: true);
        return result.Succeeded ? Success() : Error("Invalid email or password, or account temporarily locked.", 401);
    }

    private static async Task<IResult> Forgot(EmailRequest input, UserManager<AccountUser> users, AccountOptions options, AccountMail mail, HttpContext http)
    {
        if (!options.EmailEnabled) return Error("Email recovery is not configured.", 503);
        if (string.IsNullOrWhiteSpace(input.Email) || input.Email.Length > 254) return Success();
        var user = await users.FindByEmailAsync(input.Email.Trim());
        if (user is not null)
        {
            try { await mail.SendAsync(user, await users.GeneratePasswordResetTokenAsync(user), true, http.RequestAborted); }
            catch (System.Net.Mail.SmtpException)
            {
                // Recovery failures must not turn into an account-existence oracle.
                http.RequestServices.GetRequiredService<ILogger<AccountMail>>().LogWarning("Password recovery email delivery failed");
            }
        }
        return Success();
    }

    private static async Task<IResult> Reset(TokenRequest input, UserManager<AccountUser> users)
    {
        if (!ValidToken(input) || string.IsNullOrEmpty(input.Password) || input.Password.Length > 256) return Error("Invalid or expired reset link.");
        var user = await users.FindByIdAsync(input.UserId);
        if (user is null) return Error("Invalid or expired reset link.");
        var result = await users.ResetPasswordAsync(user, input.Token, input.Password);
        return result.Succeeded ? Success() : Error("Invalid or expired link, or password does not meet requirements.");
    }

    private static bool ValidToken(TokenRequest input) => !string.IsNullOrEmpty(input.UserId) && input.UserId.Length <= 128
        && !string.IsNullOrEmpty(input.Token) && input.Token.Length <= 4096;
    private static async Task<IResult> Verify(TokenRequest input, UserManager<AccountUser> users, SignInManager<AccountUser> signIn, HttpContext http)
    {
        if (!ValidToken(input)) return Error("Invalid or expired verification link.");
        var user = await users.FindByIdAsync(input.UserId);
        if (user is null) return Error("Invalid or expired verification link.");
        var result = await users.ConfirmEmailAsync(user, input.Token);
        if (!result.Succeeded) return Error("Invalid or expired verification link.");
        if (http.User.FindFirstValue(ClaimTypes.NameIdentifier) == user.Id) await signIn.RefreshSignInAsync(user);
        return Success();
    }

    private static async Task<IResult> Resend(UserManager<AccountUser> users, AccountOptions options, AccountMail mail, HttpContext http)
    {
        if (!options.EmailEnabled) return Error("Verification email is not configured.", 503);
        var user = await users.GetUserAsync(http.User);
        if (user is not null && !user.EmailConfirmed)
            await mail.SendAsync(user, await users.GenerateEmailConfirmationTokenAsync(user), false, http.RequestAborted);
        return Success();
    }

    private static IResult Google(string? returnUrl, AccountOptions options, SignInManager<AccountUser> signIn)
    {
        if (!options.GoogleEnabled) return Error("Google sign-in is not configured.", 503);
        var redirect = "/api/account/google/complete?returnUrl=" + Uri.EscapeDataString(AccountSecurity.LocalReturnUrl(returnUrl));
        return Results.Challenge(signIn.ConfigureExternalAuthenticationProperties("Google", redirect), ["Google"]);
    }

    private static IResult LinkGoogle(AccountOptions options, SignInManager<AccountUser> signIn, HttpContext http)
    {
        if (!options.GoogleEnabled) return Error("Google sign-in is not configured.", 503);
        return Results.Challenge(signIn.ConfigureExternalAuthenticationProperties("Google", "/api/account/google/complete?link=true",
            http.User.FindFirstValue(ClaimTypes.NameIdentifier)), ["Google"]);
    }

    private static async Task<IResult> CompleteGoogle(string? returnUrl, bool? link, UserManager<AccountUser> users,
        SignInManager<AccountUser> signIn, HttpContext http)
    {
        var linkUserId = link == true ? http.User.FindFirstValue(ClaimTypes.NameIdentifier) : null;
        if (link == true && linkUserId is null) return Results.LocalRedirect("/account/login?error=link_session_expired");
        var info = await signIn.GetExternalLoginInfoAsync(linkUserId);
        if (info is null) return Results.LocalRedirect("/account/login?error=google_failed");
        // Always consume the short-lived external cookie, including error paths.
        await http.SignOutAsync(IdentityConstants.ExternalScheme);
        if (link == true)
        {
            var current = await users.GetUserAsync(http.User);
            if (current is null || !current.EmailConfirmed) return Error("A verified session is required.", 403);
            var linked = await users.AddLoginAsync(current, info);
            return Results.LocalRedirect(linked.Succeeded ? "/workspace/templates" : "/account/login?error=google_already_linked");
        }
        var existing = await users.FindByLoginAsync(info.LoginProvider, info.ProviderKey);
        if (existing is null)
        {
            var email = info.Principal.FindFirstValue(ClaimTypes.Email);
            var verified = info.Principal.FindFirstValue("google_email_verified");
            if (string.IsNullOrWhiteSpace(email) || !string.Equals(verified, "true", StringComparison.OrdinalIgnoreCase))
                return Results.LocalRedirect("/account/login?error=google_email_unverified");
            if (await users.FindByEmailAsync(email) is not null)
                return Results.LocalRedirect("/account/login?error=sign_in_to_link_google");
            existing = new AccountUser { UserName = email, Email = email, EmailConfirmed = true };
            var created = await users.CreateAsync(existing);
            if (!created.Succeeded) return Results.LocalRedirect("/account/login?error=google_failed");
            var added = await users.AddLoginAsync(existing, info);
            if (!added.Succeeded)
            { await users.DeleteAsync(existing); return Results.LocalRedirect("/account/login?error=google_failed"); }
        }
        var result = await signIn.ExternalLoginSignInAsync(info.LoginProvider, info.ProviderKey, false, bypassTwoFactor: false);
        return Results.LocalRedirect(result.Succeeded ? AccountSecurity.LocalReturnUrl(returnUrl) : "/account/login?error=google_failed");
    }

    public sealed record Credentials(string Email, string Password);
    public sealed record EmailRequest(string Email);
    public sealed record TokenRequest(string UserId, string Token, string? Password = null);
}
