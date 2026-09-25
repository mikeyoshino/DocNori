import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateWord,
  pdfName,
} from "../src/SabuySign.Web/Client/word-pdf/files";
test("Word inputs enforce extension, nonempty and 50 MB boundary", () => {
  assert.equal(validateWord({ name: "จดหมาย.DOCX", size: 50_000_000 }), "");
  assert.equal(validateWord({ name: "old.doc", size: 12 }), "");
  for (const f of [
    { name: "a.docm", size: 12 },
    { name: "a.pdf", size: 12 },
    { name: "a.docx", size: 0 },
    { name: "a.docx", size: 50_000_001 },
  ])
    assert.notEqual(validateWord(f), "");
});
test("PDF download names preserve Thai and avoid duplicates in batch", () => {
  const names = new Set<string>();
  assert.equal(pdfName("เอกสาร.docx", names), "เอกสาร.pdf");
  assert.equal(pdfName("เอกสาร.doc", names), "เอกสาร (2).pdf");
  assert.equal(pdfName("เอกสาร.DOCX", names), "เอกสาร (3).pdf");
});
