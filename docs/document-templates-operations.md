# Document templates: running and deploying

This feature adds `/templates` (public SSR landing), `/workspace/templates` (private workspace), and `/account/*`. Public PDF tools remain usable without an account. No production deployment is included.

## Required settings

Use environment configuration; never commit credentials:

- `Accounts__ConnectionString`: PostgreSQL connection. Accounts and templates use separate tables/schemas in the configured database.
- `Accounts__PublicOrigin`: fixed HTTPS origin, such as `https://docnori.com`.
- `Accounts__DataProtectionPath`: persistent private directory for cookie/email-token keys (Compose uses `/keys`).
- `Templates__StoragePath`: private persistent source PDF directory (Compose uses `/templates`).
- `Accounts__Google__ClientId` and `Accounts__Google__ClientSecret`: web OAuth client with authorized redirect URI `https://docnori.com/signin-google`.
- `Accounts__Smtp__Host`, `Port` (587), `User`, `Password`, `From`: verified mail sender supporting STARTTLS, for verification and recovery.

`infra/compose.yaml` maps `ACCOUNTS_*` environment variables for local configuration. HTTP localhost public tools continue to work, but real account browser testing needs HTTPS (Secure cookies). Run the Host directly with a development certificate, configure its matching HTTPS PublicOrigin, and supply PostgreSQL/storage paths. Frontend Playwright fixtures can exercise UI over HTTP by mocking account/template endpoints; this does not test authentication.

Production configuration belongs in the protected `/etc/docnory/accounts.env`, read only by the Host (optional until configured); database credentials may use the existing private PostgreSQL instance. The production compose file adds persistent template/key volumes and an outbound network for Host SMTP/Google calls. The backend database remains on its internal network. Nginx must use the updated account/templates route to allow POST/PUT/DELETE and PDF uploads. Do not expose the Host port directly to the internet.

## Data and privacy

Only authenticated verified owners can list/read/edit/copy/delete their templates. Stored source PDFs are server-readable private account storage, not end-to-end encrypted. Source PDFs and template field defaults are retained until the owner deletes the template. Filling another document uses a fresh copy of saved defaults; filled values and resulting PDFs remain in the browser and are never submitted to an API.

Back up PostgreSQL, `/templates`, and `/keys` together, with private permissions and an explicit retention policy. Deleting a template revokes API access immediately and queues binary cleanup with retries; backups can retain historical copies until expiry. Never enable request body logging or query-string access logging on account/verification/OAuth/private workspace routes. Do not add analytics/session replay/ads to the private workspace.

## Acceptance before production enablement

1. Apply config and volume changes, confirm old public tools and existing apps still work.
2. Register with a real test mailbox; verify, log in, reset password, and confirm the old session is invalidated.
3. Complete Google login and explicitly link Google to an existing email account. Do not auto-link solely by matching email.
4. Upload a Thai PDF, place fields, save, fill a new document, inspect and download; verify a second account receives 404 for all first-account template IDs.
5. Check source PDF and key persistence across restart, deletion retries, and a backup/restore drill.
6. Monitor storage quotas, SMTP failures and database capacity. Before multiple Host replicas, configure a shared private file volume, shared Data Protection keys, and distributed abuse limits. Current account limiter is per process.

See `document-templates-backend.md` and `src/SabuySign.Host/Features/Accounts/README.md` for API details and limits.

## Local Google sign-in

The configured Google project is `docnori-auth` (DocNori). Its Web OAuth client accepts `https://docnori.com/signin-google` and `https://localhost:5443/signin-google`.

Local credentials are in the gitignored, owner-readable `.env`. Do not commit the downloaded client JSON. After configuring the Accounts values and `ACCOUNTS_DEV_DB_PASSWORD`, run:

```sh
python3 scripts/run-accounts-local.py
```

This starts a dedicated persistent PostgreSQL service through `infra/compose.accounts-dev.yaml` on loopback port55440, then the Host at `https://localhost:5443`. The account database uses Docker volume `docnori-accounts-dev_accounts-data`; PDF templates and Data Protection keys use gitignored `.local/` directories. Do not delete those directories or the database volume if local templates must be retained. A trusted .NET localhost development certificate is required.

Open `https://localhost:5443/account/login` and choose Google. Actual account selection and Google consent are completed by the user. A passing authorization-redirect check does not certify the complete provider callback. SMTP is configured separately; Google login does not require SMTP. Production credentials belong in the Host-only `/etc/docnory/accounts.env`; importing local credentials does not deploy or activate production login.
