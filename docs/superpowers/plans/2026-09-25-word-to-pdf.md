# Word to PDF Implementation Plan

> Execute inline with executing-plans. Preserve unrelated paid PDF-to-Word work.

**Goal:** Free Thai-friendly DOC/DOCX to PDF, up to ten 50 MB files, with readable previews and downloads.

**Architecture:** Extend the existing PostgreSQL conversion queue with a Word kind. Worker runs LibreOffice in a restricted per-job Linux process with macros and link updates disabled, no network and no access to other jobs. Existing leases, capacity, cancellation and cleanup apply. Frontend converts sequentially, retains results in browser memory, cancels active server work on leaving. No account or payment.

**Design:** Existing blue/white DocNori system and SVG artwork; generous file area and compact right action panel. States: choose, selected, queued/uploading/converting, partial/success, invalid/service error. At most ten cards with file names, size, status, remove/preview/download. PDF preview dialog with page navigation. One primary action, no advanced settings or cancel button. Responsive stacked layout, visible focus, status announcements, reduced motion. Server-rendered landing includes concise Thai FAQ and privacy disclosure.

- [x] Backend: validate kinds/limits and content; isolated LibreOffice with Thai fonts; PDF endpoint; actual DOC/DOCX and malicious-document regression tests.
- [x] UI: shared lifecycle reused, batch limits, add/remove, partial retry, PDF preview, individual and ZIP download; tool catalog/navigation/SSR SEO.
- [x] Verify: build/typecheck/format; queue/media regressions; real Thai/table/image/multipage DOCX conversion, legacy DOC, invalid and external-link files; desktop/mobile browser tests and screenshots.
- [x] Document worker dependencies, limits, temporary processing and layout/font caveats. Independent code review and fix findings.


Verification: 54 JS unit tests, 12 backend tests including PostgreSQL queue integration, 11 browser tests (Word + existing video tools), and six real sandbox smoke checks passed. Independent review finding (double departure confirmation) fixed and regression tested. PDF output visually checked in desktop/mobile screenshots. TypeScript/Prettier pass. Scoped dotnet format passes; full solution format still reports pre-existing whitespace in unrelated paid OCR code. Local Docker UI updated, no production deployment in this task.

Final UI recheck: four Word browser tests passed through http://localhost:8080, including single-result primary download and new-batch reset. Local host/worker updated to tested image; disposable test stack removed.
