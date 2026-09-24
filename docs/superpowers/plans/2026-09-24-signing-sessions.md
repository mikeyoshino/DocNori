# Shared signing sessions implementation plan

Approved design: one encrypted PDF per session, anonymous link access, unrestricted signature placement on all pages, immutable confirmed batches, live updates, owner close, 24-hour final download, seven-day open expiry. Self signing stays local. Match existing editor/icons; no production deployment in this task.

Architecture: PostgreSQL stores encrypted document and append-only encrypted signature batches. AES-GCM key is in URL fragment only; separate random owner/invite/participant credentials authorize requests, stored hashed. Browser renders and exports; server never receives the decryption key. Authenticated long-poll updates provide durable live synchronization without query-string credentials. No ads on signing pages. All participants see same ordered batch snapshot. Serializable session row locking resolves close/confirm races. Owner closure compares revision and requires refresh if signatures arrived meanwhile.

- [x] Backend: bounded durable store, authorization, join, encrypted batches, idempotence, finalization and delete, expiry cleanup; integration tests against PostgreSQL.
- [x] Browser: authenticated client, encryption and input validation, recovery in sessionStorage, retry same batch ID, reconnect from snapshot.
- [x] Editor: mode chooser, shared controls and invitations via email composer/copy link, committed read-only overlay, pending signatures remain undoable, immutable export after closure.
- [x] UX: existing icons/colors; mobile layout; busy/error/offline/expired states; no focus/scroll stealing on updates; explicit storage and deletion copy.
- [x] Verification: crypto/validation unit tests, API authorization/concurrency/retention, two independent browser contexts, final exported PDF, self-sign regression, typecheck, format and .NET build.

Operations: compose activates existing PostgreSQL for session data. SigningSessions__ConnectionString enables the feature. Limit 25 MB documents, 100 active sessions, 50 members/session, 200 batches/session, 512 KB/batch. Purge expired rows every minute with cascades. Database backups/WAL need separate operational retention; never promise erasure of third-party backups. Link loss cannot recover encryption keys. Email sharing uses user's email app, not a fake automated send. Link access is not proof of identity. No permanent accounts or documents.
