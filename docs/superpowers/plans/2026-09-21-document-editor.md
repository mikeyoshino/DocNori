# Document editor implementation plan

Goal: implement the approved desktop, memory-only Thai PDF text editor.
Spec: ../specs/2026-09-21-document-editor-design.md
Execution: inline. User explicitly requested implementation; proceed without another approval loop. No git repository exists, so work in place and do not create a worktree or claim commits.

## Constraints
Blazor WebAssembly, TypeScript PDF engine adapter, self-hosted assets, no document uploads or persistent drafts, searchable/copyable Thai, open-source dependencies, PostgreSQL Compose prepared but not required by editor.

## Tasks
- [x] 1. Scaffold .NET 10 standalone WASM and TypeScript toolchain; pin versions, build scripts and self-host Sarabun/font license.
- [x] 2. Write PDF round-trip tests with Thai fixtures; prove shaping, glyph placement and Unicode extraction. Implement exporter and renderer adapter. Reject encrypted/signed files. Record evidence and limitations.
- [x] 3. Write session tests for undo/redo, redo invalidation, export revision and bounds; implement model and commands.
- [x] 4. Implement Blazor landing/editor shell and TS canvas/text interaction, sidebar tools, page selection, zoom, drag/resize, keyboard shortcuts, output preview/download and lifecycle cleanup.
- [x] 5. Add Docker static host/PostgreSQL, formatting CI, README and browser tests. Verify build/format, interaction, privacy and screenshots; record tests not executable locally.

## Review focus
- Thai mark positioning and Unicode extraction: compare glyph advances/offsets and extracted strings on real output.
- Rotated/cropped pages: viewport round-trip coordinates and export placement fixtures.
- File replacement/export errors: preserve existing session; no stale preview download.
- Undo/redo and text focus: edits restore exact data; keyboard shortcuts never hijack text selection.
- Privacy/lifecycle: no storage writes or document network requests; unload warning and release resources.

## Verification commands
`npm test`, `npm run typecheck`, `npm run build`, `dotnet build`, `dotnet format --verify-no-changes`, `npx playwright test`, `docker compose -f infra/compose.yaml config --quiet`.

## Ledger
- Initial environment: SDK 10.0.302, runtime 10.0.10 available. Node 20 and global npm 12 have version mismatch; select compatible toolchain locally. No existing application or git metadata.

## Execution results
- Tasks 1–5 implemented and verified. Manual cross-viewer release checks remain explicitly documented.
- Ruling: execute in place because this directory has no git repository. No commits or branch integration claimed.
- Ruling: native .NET tool IPC was blocked in sandbox; approved elevated build/format commands succeeded. Node 24 used from the existing local installation.
- Ruling: retain exact Unicode via a derived shaped-grapheme OpenType font; ordinary per-glyph mapping failed real sara-am regressions. Cost: fixed-font Thai/English scope and no cross-grapheme kerning; CSS disables kerning/optional ligatures to match.
- Ruling: use unzoomed, rotated visible-page points for editor model, map to PDF coordinates during export including CropBox/MediaBox intersection and UserUnit.
- Ruling: initial guardrails 25 MB, 100 pages, 16M canvas pixels; synthetic performance evidence does not establish large scanned-document capacity.
- Independent code review completed; font-resource collision, crop intersection, and all-page size validation fixed with regressions.
- Verification details and manual release gates: ../../verification/2026-09-21-editor.md.

- Final verification: 13 Node tests; 4 Chromium tests on Docker Release; format/typecheck/build clean; PostgreSQL healthy; static host rejects POST. Local app remains available on port 8080.
