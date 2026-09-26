# Private document template storage

The Host API stores reusable PDF templates and field definitions for verified account owners. Filled values and generated PDFs have no server endpoint and must remain in browser memory. Source PDFs are server-readable private storage, not end-to-end encrypted.

## Configuration

Set both `Accounts:ConnectionString` (PostgreSQL) and `Templates:StoragePath` (a persistent private directory outside `wwwroot`). Missing configuration returns 503 for authenticated template requests. Accounts and templates deliberately use the same explicitly configured database; no unrelated connection string enables this feature. The app database role needs schema creation rights for the initial tables. Files use opaque random keys, private Unix permissions, and are returned only after owner authorization.

Configuration keys below use bytes for storage limits:

| Key under `Templates:` | Default | Maximum |
| --- | ---: | ---: |
| `MaxTemplates` | 20 | 1000 |
| `MaxAccountBytes` | 104857600 | 2147483647 |
| `MaxFileBytes` | 26214400 | 26214400 |
| `MaxPages` | 100 | 100 |
| `MaxFields` | 100 | 1000 |
| `MaxPlacements` | 300 | 3000 |

Values are clamped to positive supported limits. `GET /api/templates/limits` returns actual effective limits to verified owners. Account storage quota counts source PDF bytes. Metadata/revisions require additional database capacity and operational monitoring.

The file volume and PostgreSQL data must both be backed up. Use coordinated snapshots or pause template writes during backup. Restore them together, retaining their file-key references. Configure backup retention and disclose it before launch; removing a template revokes active API access immediately but does not erase previously downloaded files or historical backups.

## API contract

All routes require the `AccountsVerified` policy and a `NameIdentifier` claim. Every mutation validates `X-CSRF-TOKEN` using ASP.NET antiforgery before reading its body. Refresh the token after an account identity change. Private responses use `Cache-Control: no-store`.

- `GET /api/templates`: `{id,name,version,updatedAt}[]`.
- `GET /api/templates/limits`: effective limits.
- `POST /api/templates`: multipart `name`, exactly one `file`; returns 201 detail.
- `GET /api/templates/{id}`: `{id,name,version,definition}`.
- `GET /api/templates/{id}/file`: authenticated PDF attachment.
- `PUT /api/templates/{id}`: `{name,version,definition}`; returns updated detail; stale version returns 409.
- `POST /api/templates/{id}/duplicate`: empty JSON; new template and fresh field/placement IDs.
- `DELETE /api/templates/{id}`: 204; UI must confirm the name before issuing the request.

Definitions contain `fields:[{id,label,type,required,defaultValue}]` and `placements:[{id,fieldId,page,x,y,width,height,size,color,align,multiline}]`. Types are `text|date|number`; alignment is `left|center|right`; colors use `#RRGGBB`. Pages are zero-based. Coordinates are visual PDF points relative to the visible rotated crop rectangle. Numeric defaults remain strings. Default dates use ISO `yyyy-MM-dd`.

The server parses PDFs with PdfPig, rejects encryption (including empty-user-password protection), invalid files, digital signature fields/dictionaries, excessive pages, and unsupported dimensions. It inspects parsed objects inside compressed object streams. It does not rasterize the source PDF. This validation is not a general PDF sanitization service.

Every query scopes to the authenticated owner; another owner's IDs return 404. A PostgreSQL advisory transaction lock serializes each owner's quota-changing operations and saves. Current definition and immutable revision are written atomically. PDF files are created before their metadata transaction commits, so cancellation may leave an unreachable file but never a committed row intentionally pointing to a removed file.

Deletion writes a durable retry queue in the same transaction that removes metadata and revisions. Maintenance retries deletion every minute. Unreferenced PDF files older than 24 hours are cleaned up after checking the database; recent files remain protected from in-progress uploads. Storage outages fail closed with 503 and maintenance retries initialization. Neither document names, content, nor field values are logged by this feature.

## Verification

`dotnet test tests/Templates.Tests` runs validation and the unconfigured HTTP test. Set `TEMPLATES_TEST_DB` to an isolated PostgreSQL database to enable SQL/HTTP integration tests. Do not point tests at production. Tests create uniquely owned rows and temporary file roots and exercise owner isolation, all mutation CSRF checks, unverified/anonymous denial, atomic revision conflicts, simultaneous quota attempts, deletion, and encrypted/signed PDF fixtures.

Example local test connection: `Host=127.0.0.1;Port=55439;Database=templates_test;Username=postgres;Password=templates-test-only`. This value is exclusively for the disposable local test container and is not a deployment credential.
