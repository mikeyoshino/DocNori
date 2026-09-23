import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import { parsePages, splitPdf } from "../src/SabuySign.Web/Client/split/pdf";
test("page ranges deduplicate and preserve document order, rejecting invalid input", () => {
  assert.deepEqual(parsePages("5, 1-3, 2", 6), [0, 1, 2, 4]);
  for (const value of ["", "0", "7", "3-1", "1,", "1.5", "1-2-3", "x", "-1"])
    assert.throws(() => parsePages(value, 6));
});
test("split exports selected or remaining pages preserving size, rotation and original", async () => {
  const doc = await PDFDocument.create();
  for (const width of [200, 300, 400, 500]) doc.addPage([width, 600]);
  doc.getPage(2).setRotation(degrees(90));
  const input = await doc.save();
  const selected = await PDFDocument.load(await splitPdf(input, "1, 3"));
  assert.deepEqual(
    selected.getPages().map((p) => p.getWidth()),
    [200, 400],
  );
  assert.equal(selected.getPage(1).getRotation().angle, 90);
  const remaining = await PDFDocument.load(await splitPdf(input, "1, 3", true));
  assert.deepEqual(
    remaining.getPages().map((p) => p.getWidth()),
    [300, 500],
  );
  assert.equal((await PDFDocument.load(input)).getPageCount(), 4);
  await assert.rejects(splitPdf(input, "1-4", true), /ไม่มีหน้า/);
  await assert.rejects(splitPdf(input, "5"));
});

test("custom and fixed ranges produce independent PDFs or one deduplicated PDF", async () => {
  const { rangeGroups, fixedRanges, exportGroups } =
    await import("../src/SabuySign.Web/Client/split/pdf");
  assert.deepEqual(fixedRanges(5, 2), [
    { start: 1, end: 2 },
    { start: 3, end: 4 },
    { start: 5, end: 5 },
  ]);
  assert.throws(() => fixedRanges(5, 0));
  assert.throws(() => rangeGroups([{ start: 3, end: 2 }], 5));
  const doc = await PDFDocument.create();
  for (const width of [200, 300, 400, 500]) doc.addPage([width, 600]);
  const bytes = await doc.save(),
    groups = rangeGroups(
      [
        { start: 3, end: 4 },
        { start: 1, end: 3 },
      ],
      4,
    );
  const parts = await exportGroups(bytes, groups, false);
  assert.deepEqual(
    (await PDFDocument.load(parts[0].bytes))
      .getPages()
      .map((p) => p.getWidth()),
    [400, 500],
  );
  assert.equal((await PDFDocument.load(parts[1].bytes)).getPageCount(), 3);
  const combined = await exportGroups(bytes, groups, true);
  assert.equal(combined.length, 1);
  assert.deepEqual(
    (await PDFDocument.load(combined[0].bytes))
      .getPages()
      .map((p) => p.getWidth()),
    [200, 300, 400, 500],
  );
});
test("ZIP includes standard CRC32, directory records and the unchanged file bytes", async () => {
  const { zipFiles } = await import("../src/SabuySign.Web/Client/split/zip");
  const zip = zipFiles([
    { name: "part-1.pdf", bytes: new TextEncoder().encode("123456789") },
  ]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0xcbf43926);
  assert.equal(new TextDecoder().decode(zip.slice(40, 49)), "123456789");
  assert.equal(view.getUint32(49, true), 0x02014b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
});
