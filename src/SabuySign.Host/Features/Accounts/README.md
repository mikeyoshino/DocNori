# Account operations

Register `builder.AddAccounts()`; put `app.UseAuthentication()` and `app.UseAuthorization()` before antiforgery middleware, and call `app.MapAccounts()`. For a private application port behind HTTPS ingress, call `app.UseAccountsOrigin()` before authentication. It applies only the fixed validated `Accounts:PublicOrigin` scheme/host to `/api/account`, `/api/templates` and `/signin-google`, including a configured port; it never trusts client-supplied forwarded headers. Keep the backend port private.

`AccountsVerified` requires a session with the `email_verified=true` claim. Owner IDs come from `ClaimTypes.NameIdentifier`.

## Configuration

Use secret/environment configuration (double underscores separate sections). Never commit passwords, OAuth secrets or connection strings.

- `Accounts:ConnectionString`: PostgreSQL database for persistent Identity data. The initial `accounts` schema is created lazily under a PostgreSQL transaction advisory lock; the DB role needs schema/table creation permissions for first setup. Existing tables are never deleted. Future schema changes must use reviewed migrations.
- `Accounts:PublicOrigin`: exact HTTPS origin, e.g. `https://docnori.com`, with no path, credentials, query or fragment. This trusted configuration supplies email links; request Host never supplies them.
- `Accounts:Smtp:Host`, `Port` (587), `User`, `Password`, `From`: SMTP using mandatory STARTTLS. Verify sender/domain with your provider. `IAccountEmailSender` is replaceable for tests; no debug token responses or real emails in automated tests.
- `Accounts:Google:ClientId`, `ClientSecret`: OAuth client. Register `https://YOUR-ORIGIN/signin-google` with Google. OAuth uses PKCE and protected state/correlation, external cookie expires in 5 minutes. Provider access/refresh tokens are not persisted.

Missing database configuration disables accounts. Missing SMTP/public origin disables email registration/recovery; missing Google credentials disables Google. Temporary database/email failures return 503 and do not prevent public tooling from starting. `me.available` indicates account database readiness; `googleEnabled` additionally requires Google and public origin configuration.

Run behind HTTPS (including local browser testing); all session, external and CSRF cookies are Secure/HttpOnly. Use the fixed-origin middleware described above for private HTTPS ingress, or configure trusted proxy forwarded headers before authentication so OAuth callback scheme is HTTPS; do not trust arbitrary forwarded headers. Persist ASP.NET Data Protection keys on an access-restricted volume and share only between trusted application replicas. Back up those keys and the PostgreSQL database together; losing keys invalidates sessions and outstanding email tokens. No keys, mail bodies, request bodies, query tokens or credential values should be logged. Disable query-string logging on `/account/verify`, `/account/reset`, OAuth callback routes, and reverse proxies.

Cookies last 12 hours with sliding renewal. Identity security stamps are validated on every authenticated request, so password reset invalidates previous sessions immediately. Passwords require 12 characters, uppercase/lowercase, digit and symbol. Five failed password attempts lock the account for 15 minutes. Verify/reset tokens expire after one hour. Reset tokens become unusable after password reset. Verification tokens can be retried safely; verification itself is idempotent.

All `/api/account` requests have a 20/minute limiter per authenticated user, with anonymous requests partitioned by remote IP. Configure trusted client IP forwarding before production for fair anonymous limits; without it, users behind a proxy share that proxy IP limit. Run authentication before rate limiting. SMTP abuse monitoring and distributed rate limits should be configured before horizontal scaling. Forgot-password success messages do not reveal whether an email exists.

## Browser contract

`GET /api/account/me` returns `{authenticated,email,verified,googleEnabled,emailEnabled,googleLinked,available}`. `GET /api/account/csrf` returns `{token}` and sets a secure antiforgery cookie. Every unsafe request must carry `X-CSRF-TOKEN` and the cookies. Get a fresh CSRF token after login, register, logout or verification because tokens bind to the current identity.

POST JSON endpoints: `/register` and `/login` `{email,password}`; `/logout`, `/resend` `{}`; `/forgot` `{email}`; `/reset` `{userId,token,password}`; `/verify` `{userId,token}`. Errors contain `{error}`, successes `{success:true}`. Registration signs into an unverified session so users can resend mail; verified authorization still denies template access. Mail send failures after successful registration leave the account/session intact: use resend.

`GET /google?returnUrl=/workspace/templates` starts Google login. Only local return URLs are accepted. If an email already has an account, Google does not automatically link it. The user signs into that existing account, verifies it, then explicitly submits `POST /google/link` with CSRF (normal form submission may use the antiforgery form token). This endpoint starts OAuth with the current stable user ID bound in protected state; completing the flow requires the same authenticated verified account. Google identities already attached elsewhere cannot be linked. GET requests never initiate linking.

No deployment was performed by this change. Production acceptance requires a configured disposable PostgreSQL DB, test SMTP provider, Google test account, HTTPS/proxy setup, email delivery/expiration checks, account isolation and backup/restore checks. Unit tests use in-memory Identity storage and captured email; they cannot certify provider connectivity.
