# PDF to Word: reference flow and delivery

Reference: Screen Recording 2569-09-23 at 20.04.27.mov (16.59 seconds, inspected at one frame per second and expanded option/confirmation frames).

## Observed flow
- 00–02: PDF-to-Word workspace: cover on the left, add-files animation; options right. No OCR selected. Scanned-page notice above it. OCR carries Premium label. Convert button at bottom.
- 03–08: conversion of the scanned PDF opens a confirmation explaining that without OCR, scanned pages become images in Word and their text is not editable. Offers continue without OCR / apply OCR.
- 09–10: conversion progress.
- 11–16: result with explicit Word download, back navigation and other service links.

## Confirmed scope
User chose ordinary Word conversion now; OCR should say “สำหรับสมาชิกแบบชำระเงิน · เร็ว ๆ นี้”. No account, payment collection, premium entitlement or working OCR is implemented. Preserve local-only document processing and SSR entry. Output DOCX, not legacy binary DOC.

## Design and architecture
Reuse DocNory conversion CSS, FileSourcePicker, ConversionProgress, ConversionResult, PDF.js image extraction and shared ZIP writer. Thai UI, blue primary CTA, neutral document stage, right settings sidebar; mobile stacks content without a sticky button hiding settings. PDF-to-Word has its own controller and conversion engine.

State flow: entry → read/inspect → options → scan confirmation when needed → progress (cancelable) → explicit DOCX/ZIP download. Return retains source files. Remove/reset/dispose releases memory and Blob URLs. Invalid files preserve previously valid inputs. OCR is natively disabled with visible availability copy.

Use PDF.js to extract positioned text and decoded raster images; docx packages editable Word paragraphs and images. Pages with no extractable letters/digits are rendered as images only after confirmation. Match original Thai glyph runs to remove provably inferred spaces inside Thai words. Do not guess spelling or remove intentional spaces.

## Practical limits
Text-first reconstruction, not a full PDF layout reconstruction engine. Images follow page text; tables/columns may reflow and are not semantic tables; vector graphics, original fonts and colors are not retained on text pages. Font uses Sarabun with viewer fallback. Pages with existing OCR text layers use those layers; mixed pages containing some text and scan images are not guaranteed to trigger the no-text warning. Rendered image pages preserve visual content but are not editable.

Limits: 20 PDFs, 25 MB, 100 pages, Word page dimensions up to 22 inches, bounded canvas/output sizes, sequential processing. No server uploads, persistent document storage or third-party conversion APIs.

## Verification
Browser coverage: SSR/indexable catalog, disabled upcoming OCR, real editable DOCX XML, XML escaping, mixed text/scan confirmation and image output, invalid input recovery, mobile layout, reset, Thai text, ZIP with separate DOCX files, and cancellation retaining inputs. Unit tests cover line grouping, Thai combining marks, XML control filtering and source-verified spacing correction.

Downloaded Thai DOCX also opened successfully in macOS Quick Look and textutil; visually inspected Thai vowels/marks. Microsoft Word/LibreOffice application-specific layout compatibility has not been directly tested.

Checks completed: all 26 browser regression tests passed on Docker; all 34 unit tests passed; TypeScript typecheck, Prettier check, dotnet format verification and .NET build passed. A final focused Word run verifies native Word tab elements after the last export improvement.
