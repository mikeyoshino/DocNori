# Word to PDF

Route: `/tools/word-to-pdf`. Free DOC/DOCX, up to ten files per page, each 50,000,000 bytes. Browser uploads and converts sequentially through the existing conversion queue. Successful results remain available locally when a later file fails. The original Word size/orientation is retained; no artificial reflow settings are offered. PDF preview has page navigation and individual downloads; batch ZIP uses UTF-8 names and avoids duplicate filenames.

## Worker

`infra/Dockerfile` installs LibreOffice Writer, python3-uno, fontconfig, Sarabun, Noto, Thai TLWG and Carlito/Caladea/Liberation replacements. No new paid API is needed. The existing `media-worker` process claims `word-pdf` jobs from PostgreSQL, so multiple workers can use the same queue and shared storage as described in `media-conversion-operations.md`. Concurrency is bounded by CPU/memory; document work shares slots with video conversion. The five-minute execution deadline, leases, heartbeat, capacity and retention limits apply.

A new per-run LibreOffice profile prevents profile locks between jobs. UNO opens Writer documents read-only and hidden with `MacroExecutionMode=NEVER_EXECUTE`, `UpdateDocMode=NO_UPDATE`, and an interaction handler which aborts password/repair prompts. DOCX packages are checked for expanded size (200 MB), entry count (10,000), macros, embedded objects and external resources; ordinary hyperlinks are allowed. Legacy DOC must be an OLE container and resolve to a Writer document. Protected/unsupported inputs fail without producing a downloadable result.

The image makes global `/tmp` and `/var/tmp` read-only to the app user; .NET uses writable `/app/tmp`. LibreOffice overrides `TMPDIR` to the run directory and `OSL_SOCKET_PATH=.` to keep its IPC sockets within that directory. Its binary is invoked directly, handling its one-time startup exit code 81. Do not override global `/tmp` with a writable mount without re-testing isolation/IPC.

The `word-sandbox` launcher uses Landlock ABI >=3 and seccomp with no privilege escalation. It permits system binaries/libraries/fonts to be read, the current job directory to be written, and denies access to other jobs and non-Unix network sockets. The converter receives no database/API secrets in its environment. Isolation failure prevents conversion; there is no insecure fallback. **Workers require Linux with Landlock enabled, ABI >=3 (normally kernel >=6.2).** Check on the actual VPS before production rollout. Standard unprivileged Docker with `cap_drop: ALL` and `no-new-privileges` is supported; no Docker socket or privileged mode.

File output and temporary work are bounded by the worker budget (128 MiB per run). Leaving sends the existing cancellation beacon; if a browser disappears without notifying the server, heartbeat expiry is 120 seconds plus cleanup scheduling. Completed source documents are removed; job files are removed by existing cleanup after cancellation/expiry. No persistent recovery link/account copy.

## Fidelity

This is genuine rendered PDF containing selectable text, images and tables, not screenshots. LibreOffice and Microsoft Word can differ in font metrics, field rendering and pagination. Custom fonts are not guaranteed. Preview and an honest Thai FAQ communicate this limitation. Rendering complex content and malformed files is still a resource-sensitive operation; keep worker memory/process limits and OS/package security updates in place.

## Checks

- `node scripts/create-word-pdf-fixture.mjs`: synthetic Thai/English, table, image and two-page DOCX.
- `python3 scripts/test-word-sandbox.py <built-image>`: actual DOCX/DOC conversion, malformed/linked document rejection, filesystem/network isolation.
- `npm run typecheck && npm test && npm run build`
- `dotnet test tests/SabuySign.Signing.Tests` (set `SIGNING_TEST_DATABASE` for queue lifecycle integration tests).
- With Docker stack running: `APP_URL=http://localhost:8080 npx playwright test tests/word-pdf.spec.ts`.

Sources: [LibreOffice MediaDescriptor](https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1document_1_1MediaDescriptor.html), [Landlock ABI and filesystem restrictions](https://www.kernel.org/doc/html/v6.6/userspace-api/landlock.html).

Completed conversion removes its copied source and LibreOffice profile/temp files, retaining only the PDF until queue cleanup. Large ZIP batches above 200 MB are directed to individual downloads to bound browser memory. Native output files also have a 128 MiB file-size limit; core dumps are disabled.
