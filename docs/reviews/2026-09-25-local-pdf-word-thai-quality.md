# Local PDF → Word Thai quality audit

## Follow-up after the initial audit

The initial evidence below is preserved. A subsequent change in `layout.ts` attaches isolated Thai combining marks to a uniquely overlapping single consonant before grouping rows. Raised and lowered mark regressions now pass, together with a new ambiguous-neighbor test that leaves uncertain geometry unchanged. All six layout tests pass. This does **not** resolve the separate PDF.js cross-line extraction defect, reconstruct tables, or establish visual equivalence in Pages/Word. The real supplied PDF still requires OCR for editable text.

## Initial audit

Scope: free/local converter only; no paid APIs or document uploads. Product files were not changed. Audit used the current `convert-word/pdf.ts` and `layout.ts` bundled into an isolated Chromium page with every asset request fulfilled from local files. Private inputs and resulting DOCX files remain under `/private/tmp`; this report contains aggregate findings and synthetic examples only.

## Results

| Check | Result |
| --- | --- |
| Supplied real PDF | 930,175 bytes; 4 pages; zero PDF.js text items on every page |
| Real-file output | 660,765-byte DOCX; 4 sections and 4 drawings; 2 deduplicated PNG assets; zero editable characters; zero Word tables |
| Image fallback | All 4 pages correctly selected; PNGs 1275 × 1651; inspected embedded image shows readable Thai and preserved visible form lines |
| Synthetic editable PDF | 1 page, 4 known lines, 29 Thai combining marks; all marks and non-whitespace characters retained, in concatenated order |
| Synthetic line fidelity | FAIL: first 2 lines exact; characters moved across final 2 lines |
| Layout unit tests | Original 3 pass; 2 newly added desired-behavior regressions fail for raised/lowered isolated Thai marks (`node --import tsx --test tests/word-layout.test.ts`) |
| Browser errors | None in either completed conversion |

The supplied real PDF cannot establish editable Thai accuracy: its visible letters have no extractable text layer. Image fallback is expected, and no OCR occurs. Equality of two empty text strings is not a text-quality pass. The image was inspected, but DOCX pagination and typography were not rendered in Microsoft Word or Pages; do not claim visual equivalence or exact layout.

## Findings

### Important: Thai text can move to the previous line

A synthetic PDF generated with the existing editor exporter and bundled Sarabun font has these separate source `showText` glyph runs:

```
ยอดรวม 1,234.50 บาท
ข้อความบรรทัดถัดไป
```

PDF.js `getTextContent()` returns, and the DOCX preserves:

```
ยอดรวม 1,234.50 บาทข้
อความบรรทัดถัดไป
```

This demonstrates why character-count equality alone misses a real reading defect. The source operator glyph runs preserve the intended line boundaries; the present converter only consults those runs to repair spaces when a whole run matches (`pdf.ts`, `positioned`). Investigate extraction/run alignment and add an end-to-end regression that checks each paragraph against known input, not only total characters or a substring. Do not fix this by globally stripping Thai spaces.

The first two synthetic source lines survive exactly after the existing spacing repair:

```
น้ำ กุ้ง ปู่ ผู้รับรอง กำลัง ทดสอบภาษาไทย
เก้า เกี๊ยว เรื่อง ผู้ซื้อ ผู้ขาย ชื่อ ที่อยู่
```

### Important: separately positioned Thai marks can detach

`layout.ts:20–30` groups by baseline distance before recognizing combining marks. A minimal direct reproduction:

```ts
textLines([
  { text: 'น', x: 10, y: 20, width: 8, size: 14 },
  { text: '้', x: 13, y: 15, width: 0, size: 14 },
  { text: 'ำ', x: 18, y: 20, width: 8, size: 14 },
]).map(line => line.text)
// Actual: ['้', 'นำ']; desired logical text: 'น้ำ'
```

This is a geometry-level stress case, not a claim that the supplied PDF contains these extractable items. Matching a combining mark to an overlapping base glyph must happen before final row grouping, with tests preventing accidental attachment to neighboring lines.

### Important limitation: tables and columns are not reconstructed

The editable path creates `Paragraph`/`TextRun` objects, not `Table` objects (`pdf.ts:227–267`). Wide gaps become default Word tabs, with no tab stops at the source coordinates. Vector borders are discarded. Two independent columns with matching baselines become alternating row text (`Left one\tRight one`, then `Left two\tRight two`), so column reading order is not preserved. Classify this as readable text extraction, not editable table reconstruction.

### Important limitation: line spacing and pagination can change

Every reconstructed line becomes a paragraph with zero before/after spacing (`pdf.ts:229`); the measured `line.y` is never used for spacing. Paragraph gaps, form spacing, heading spacing, and original top position are lost. A source-page section break does not guarantee one output page if reflow overflows. Images from editable pages are appended after all text rather than retaining source placement.

### Remaining visual risk: fonts are referenced, not embedded

Runs request Sarabun, including complex-script font settings. Generated DOCX contains no embedded font files. Font availability and application shaping may change wrapping and mark positioning. Verify rendering in Word with and without Sarabun installed before stronger typography claims.

## Recommended next checks

1. Add a synthetic multi-line Thai PDF regression asserting exact paragraph boundaries and text; address the demonstrated extraction defect.
2. Add raised/lowered mark geometry regressions using fonts/PDF producers beyond the site's own exporter.
3. Add an explicit table fixture and document the loss of borders/cells until real table reconstruction exists.
4. Render DOCX in a real office application and compare page count, clipping, Thai marks, spacing, and column order. XML checks cannot establish visual accuracy.
5. For the supplied PDF, offer the existing image fallback honestly; editable text requires OCR, which was outside this audit.

Private local artifact: `/private/tmp/word-quality-real.docx`. Synthetic artifact: `/private/tmp/word-quality-latest.docx`. These artifacts are intentionally not committed.
