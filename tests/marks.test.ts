import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PDFDocument,
  PDFArray,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { Session } from "../src/SabuySign.Web/Client/editor/session.ts";
import { exportPdf } from "../src/SabuySign.Web/Client/editor/pdf.ts";
test("marks bypass text fitting; duplicate and history preserve independent style", () => {
  const s = new Session(() => {
    throw Error("Marks must not be shaped as text");
  });
  s.addMark(0, 20, 30, "check", 24, "#176ba8");
  const id = s.selected!;
  s.duplicate(id, 595, 842);
  assert.equal(s.items.length, 2);
  assert.notEqual(s.items[0].id, s.items[1].id);
  s.update(s.selected!, { mark: "cross", color: "#b13b36" });
  assert.equal(s.items[0].mark, "check");
  s.undo();
  assert.equal(s.items[1].mark, "check");
  s.redo();
  assert.equal(s.items[1].mark, "cross");
  s.remove(s.selected ?? s.items[1].id);
  s.undo();
  assert.equal(s.items.length, 2);
});
test("mark-only PDF exports visible vector strokes without requiring a font", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const s = new Session();
  for (const kind of ["check", "cross", "circle"] as const)
    s.addMark(0, 20 + s.items.length * 50, 30, kind, 24, "#176ba8");
  const result = await PDFDocument.load(
    await exportPdf(await source.save(), s.items, new Uint8Array()),
  );
  const page = result.getPage(0);
  const contents = page.node.Contents() as PDFArray;
  let text = "";
  for (let i = 0; i < contents.size(); i++) {
    const stream = result.context.lookup(contents.get(i)) as PDFRawStream;
    text += new TextDecoder().decode(decodePDFRawStream(stream).decode());
  }
  assert.match(text, /\bRG\b/);
  assert.ok((text.match(/\bS\b/g) || []).length >= 3);
  assert.equal(
    page.node.Resources()?.lookup(PDFName.of("Font"))?.toString() ?? "<<\n>>",
    "<<\n>>",
  );
});

for (const rotation of [0, 90, 180, 270])
  test(`mark export respects crop, rotation ${rotation} and UserUnit`, async () => {
    const { degrees, PDFNumber } = await import("pdf-lib");
    const { pagePoint } =
      await import("../src/SabuySign.Web/Client/editor/pdf.ts");
    const source = await PDFDocument.create();
    const p = source.addPage([600, 800]);
    p.setCropBox(20, 30, 550, 720);
    p.setRotation(degrees(rotation));
    p.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    const s = new Session();
    s.addMark(0, 100, 120, "check", 24, "#172c40");
    const result = await PDFDocument.load(
      await exportPdf(await source.save(), s.items, new Uint8Array()),
    );
    const contents = result.getPage(0).node.Contents() as PDFArray;
    const streams = Array.from({ length: contents.size() }, (_, n) =>
      new TextDecoder().decode(
        decodePDFRawStream(
          result.context.lookup(contents.get(n)) as PDFRawStream,
        ).decode(),
      ),
    ).join("");
    const first = pagePoint(
      { x: 20, y: 30, width: 550, height: 720 },
      rotation,
      105 / 2,
      132 / 2,
    );
    assert.ok(streams.includes(`${first[0]} ${first[1]} m`));
    assert.match(streams, /1\.15 w/);
  });
test("out of bounds marks are rejected instead of silently clipped", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const s = new Session();
  s.addMark(0, 590, 30, "circle", 24, "#172c40");
  await assert.rejects(
    exportPdf(await source.save(), s.items, new Uint8Array()),
    /เกินขอบหน้า/,
  );
});

test("mixed Thai text and vector marks retain searchable Thai on export", async () => {
  const { readFile } = await import("node:fs/promises");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const s = new Session();
  s.add(0, 50, 50);
  s.update(s.selected!, { text: "ชื่อ น้ำ กุ้ง" });
  s.addMark(0, 50, 110, "cross", 24, "#176ba8");
  const font = new Uint8Array(
    await readFile("src/SabuySign.Web/wwwroot/fonts/Sarabun-Regular.ttf"),
  );
  const extract = async (bytes: Uint8Array) => {
    const task = getDocument({ data: bytes, useSystemFonts: false });
    const pdf = await task.promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items
      .filter((i) => "str" in i)
      .map((i) => i.str)
      .join("");
    await task.destroy();
    return text;
  };
  const sourceBytes = await source.save();
  const baseline = await extract(
    await exportPdf(
      sourceBytes,
      s.items.filter((i) => !i.mark),
      font,
    ),
  );
  const mixed = await extract(await exportPdf(sourceBytes, s.items, font));
  // Adding vectors must not alter text extraction; PDF readers infer word spacing.
  assert.equal(mixed, baseline);
  assert.equal(mixed.replace(/\s/g, ""), "ชื่อน้ำกุ้ง");
});
