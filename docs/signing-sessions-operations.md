# Shared signing sessions

## Local

`docker compose -f infra/compose.yaml up --build -d web` starts PostgreSQL as well as host/relay/proxy. Open `/tools/fill-sign`, choose a PDF, then เซ็นเอกสาร → หลายคน. The create screen explicitly consents to uploading an encrypted document. Use an independent browser for the invite link. The owner's private link restores control on another device; save it privately. No accounts or permanent document library.

## Production configuration (not deployed by this change)

Production compose uses a dedicated `signing-db` PostgreSQL service and `signing-data` volume on DocNori's private backend network. `/etc/docnory/signing.env` (root-owned, mode 0600) holds `POSTGRES_PASSWORD` and `SigningSessions__ConnectionString` pointing at `Host=signing-db;Database=docnori_signing;Username=docnori_signing`. Configure these without putting secrets in Git. Install the reviewed compose and nginx config at `/opt/docnory/`, start `signing-db`, then deploy immutable host/relay images through the existing GitHub Actions workflow. Application deploy starts dependencies and recreates the proxy. Do not reset existing VPS databases or other apps. The application disables signing creation when no connection string is supplied.

No SMTP provider is configured: email sharing opens the user's email composer with an ordinary invitation link. It is not a verified-email or OTP workflow. Sessions are anonymous bearer-link collaboration, not certificate-based digital signatures or proof of identity.

## Privacy and retention

- AES-256-GCM document and signature batches are encrypted in the browser, with the session and batch identifiers authenticated as additional data.
- The decryption key is present only in a URL fragment, then kept in tab sessionStorage. The URL is replaced with an opaque session id before requesting the document. Owner and invite capabilities are different; the server stores SHA-256 credential hashes. Request credentials travel in headers, not URLs.
- PostgreSQL holds encrypted bytea documents and batches, lifecycle times, anonymous member numbers and presence. Names, plaintext PDF and decryption keys are not sent to the API. Ad scripts are absent from fill/sign and shared session pages.
- Service-delivered JavaScript remains part of the trust boundary. This is not a claim that a compromised browser or malicious service deployment can never read a document.
- Seven-day open lifetime; finalization changes retention once to 24 hours. Expired documents cannot be retrieved; periodic cleanup deletes rows and cascading batches/members within one minute. Immediate owner deletion revokes access and deletes rows. Existing downloads cannot be revoked.
- PostgreSQL DELETE is logical deletion, not guaranteed physical erasure from WAL/backups/disks. Operations must separately configure backup/WAL retention and access. Do not market an absolute physical-erasure deadline. Client caches may remain until the tab closes; the UI clears visible placements on revocation. Saving the owner link or shared link also preserves its key outside the service.
- The final PDF is assembled locally from the immutable original and the frozen, ordered signature snapshot. Every viewer gets the same content; generated PDF metadata may differ byte-for-byte. Confirmed batches cannot be updated/deleted individually.

## Limits and synchronization

25 MB PDF, 100 pages (existing validator), 100 stored sessions, 50 participant identities/session, 200 confirmed batches/session, 50 placements/batch, 512 KB encrypted batch. No unbounded upload buffers. Signature validation also checks actual page bounds on decrypt. A shared-link recipient can still submit malicious encrypted data; validation prevents script injection and disables invalid content rather than silently dropping signatures.

Authenticated long-poll snapshots wait up to 20 seconds and inspect changes every second. No SignalR or external message broker dependency. Metadata only is returned in snapshots; new encrypted batches are fetched once and cached. Disconnect reconnects from an authoritative database snapshot. Presence expires after 35 seconds. A row lock serializes confirmation/finalization, unique batch ids allow safe retries after lost HTTP responses, and finalization compares the revision reviewed by the owner. PostgreSQL makes sessions survive host restarts. Keep proxy read timeout above 20 seconds.

## Checks

`npm run typecheck && npm test && npm run format:check`

`SIGNING_TEST_DATABASE='<isolated PostgreSQL connection>' dotnet test tests/SabuySign.Signing.Tests --filter FullyQualifiedName~SigningSessionTests`

`APP_URL=http://127.0.0.1:8080 npx playwright test tests/signing-sessions.spec.ts tests/signatures.spec.ts`

The first command's unit suite covers encryption context/key mismatch and rejects invalid placements. API tests cover authorization, concurrent batches, retry, close revision races and expiry cleanup. Browser tests cover multiple participants/pages, live confirmed ink, final vector PDF, refresh and owner deletion.
