# Approved editor mark UI implementation

User approved the interactive mockup and requested implementation plus comparison.
Scope: vector check/cross/circle marks, centered placement, continued placement on
 desktop and single placement on mobile, sizing/color defaults, selection, drag,
keyboard nudge, duplicate, delete, undo/redo, PDF export; desktop three-column mock
and mobile bottom properties panel. Preserve Thai text and signature workflows.
No production deployment requested. Date is a mock placeholder, excluded rather
than exposing a dead production control. Keep pre-existing paid Word work untouched.

Implementation: tests for mark history/vector export -> shared geometry/model ->
editor interop/UI/CSS -> browser tests at desktop/mobile -> compare mock screenshots
and exported PDF -> independent review and fix important findings.

Implementation and review record:
- Added shared vector geometry used by SVG preview and PDF export, independent of fonts.
- Added centered mark placement, in-memory style defaults, duplication, deletion,
  history, dragging, keyboard movement and center-preserving resize with edge clamping.
- Added reusable MarkChoices, desktop inspector/picker, mobile bottom panel, page/zoom
  selectors and touch undo/redo. Existing text/signature flow remains available.
- Independent review found missing mobile undo and selected-shape editing; both fixed
  and covered by browser regressions. Picker disabled-attribute bug found during browser
  checks and fixed. Resize-center test failed before the geometry correction.
- Ruling: date was a nonfunctional placeholder in the approved prototype; omit that
  production button until its implementation is agreed. Cost: fewer toolbar items.
- Ruling: PDF content keeps its actual page geometry on mobile (fit/zoom), unlike the
  mock's responsive HTML form. Reflow would alter the document; a mobile zoom control
  is included. Preserve the approved layout for editor controls.
- Visual evidence: artifacts/editor-marks/actual-1440-edit.png,
  actual-1440-place.png, actual-390-edit.png, actual-390-place.png,
  actual-export-preview.png and sample-filled.pdf (synthetic, ignored artifacts).
- No documents uploaded in mark tests. No production deployment or commit performed.
- Final verification: TypeScript typecheck passed; 43 unit tests passed; 14 browser
  tests passed (marks, existing Thai text editor, desktop signatures and QR signing);
  dotnet format completed; Release Docker build succeeded; git diff --check clean.
  Desktop 1440x1040/mobile 390x844 screenshots inspected against the mockup and
  exported-PDF preview; source document size differs because actual PDF geometry is retained.
