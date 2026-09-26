# Document Templates Implementation Plan

**Goal:** authenticated private PDF templates with a designer and independent local fill/export.
**Architecture:** Existing Host + Blazor WASM; cookie-auth APIs; PostgreSQL; private PDF volume; browser PDF preview/export. No autosaved field values or generated output.
**Spec:** docs/superpowers/specs/2026-09-26-document-templates-design.md
**Execution:** subagent-driven-development for independent accounts/API units; coordinator owns client UI and integration. Work in existing isolated /private/tmp/docnori-media-release checkout; preserve unrelated paid Word work.

## Constraints and rulings
- User approved private server-readable template storage, both Google/email-password, explicit save, default fields, overflow blocking, owner-only access.
- Initial configurable quota: 20 templates/account, 100 MB total, 25 MB/file, 100 pages, 100 fields, 300 placements. Show actual limits.
- Workspace disabled without Accounts:ConnectionString; API returns clear 503. Google unavailable until configured; email requires configured SMTP. No production bypass for email verification.
- Field types text/date/number; placement references stable fieldId, page zero-based, visual PDF-point coordinates. Single/multiline controlled by placement. Browser uses existing font/export pipeline.

## Tasks
- [x] Accounts: standard ASP.NET Identity with PostgreSQL persistence, secure cookies/CSRF, register/login/logout/me/verify/reset, Google linking with existing-session confirmation; tests and config docs.
- [x] Templates API: owner-scoped PostgreSQL rows/revisions; private binary storage; validation/quota/concurrency/delete/copy; tests.
- [x] Client: SSR landing + authenticated workspace shell, list/new/designer/fill/account forms; text-fit domain tests; shared controls/leave guard; local export.
- [x] Integrate runtime/routes/CSP/ad-exclusion/navigation/build, local Docker private data volume, deployment instructions without deploying.
- [x] Verification: build/typecheck/unit and API tests; browser registration/list/upload/place/save/fill/defaults/overflow/export; account isolation and no submitted fill values; responsive/accessibility; final review.

## Review focus
Cross-owner access; stale saves; uploaded binary validation; Thai text overflow matching export; defaults and filled values isolation. SMTP/OAuth live checks need configured providers and must be reported separately from local tests.

## Verification evidence
- TypeScript typecheck, Prettier, client build, and .NET build passed.
- 81 JavaScript unit tests passed; new template layout tests cover Thai, defaults, repeats, overflow and special field IDs.
- 20 Accounts tests and 19 Templates tests passed; Templates tests used disposable PostgreSQL on port55439, with no template tests skipped.
- 8 browser tests passed with mocked account/template transport and real PDF.js/export worker. Covers upload/list/copy/delete, UI auth states, designer/save races, real searchable Thai PDF download, overflow, local-only fill data, and mobile tabs.
- Independent review findings resolved: CSRF identity refresh, proxy origin, runtime storage failure, configurable limits, stale export/save races and special-key dictionaries.
- Live Google OAuth and SMTP delivery remain unverified until provider credentials/configuration are supplied; no production deployment.
