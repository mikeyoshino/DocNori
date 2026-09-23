import fontkit from "@pdf-lib/fontkit";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  degrees,
  PDFDict,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { exportPdf } from "../src/SabuySign.Web/Client/editor/pdf.ts";
import type { TextItem } from "../src/SabuySign.Web/Client/editor/session.ts";
const font = new Uint8Array(
  await readFile("src/SabuySign.Web/wwwroot/fonts/Sarabun-Regular.ttf"),
);
const words = [
  "ชื่อผู้สมัคร",
  "ที่อยู่",
  "น้ำ",
  "กุ้ง",
  "ปู่",
  "ผู้รับรอง",
  "สมชาย Smith 123/45",
  "กำ น้ำ ทำ น้ำ สมชาย กำลัง",
];
for (const rotation of [0, 90, 180, 270])
  test(`Thai Unicode roundtrip and placement on cropped page rotated ${rotation}`, async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(20, 30, 550, 720);
    page.setRotation(degrees(rotation));
    const items: TextItem[] = words.map((text, i) => ({
      id: String(i),
      page: 0,
      x: 40,
      y: 40 + i * 35,
      width: 320,
      height: 32,
      text,
      size: 16,
      color: "#172433",
      align: "left",
    }));
    const output = await exportPdf(await doc.save(), items, font);
    const task = getDocument({ data: output.slice(), useSystemFonts: false });
    const loaded = await task.promise;
    const content = await (await loaded.getPage(1)).getTextContent();
    const actual = content.items
      .filter((i): i is any => "str" in i)
      .map((i) => i.str)
      .join("")

      .normalize("NFC");
    assert.equal(actual, words.join("").normalize("NFC"));
    const parsed = await PDFDocument.load(output);
    const descriptor = parsed.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .find(
        (o) =>
          o instanceof PDFDict &&
          (o.has(PDFName.of("FontFile3")) || o.has(PDFName.of("FontFile2"))),
      ) as PDFDict;
    assert.ok(descriptor, "embedded shaped OpenType descriptor exists");
    const stream = parsed.context.lookup(
      descriptor.get(PDFName.of("FontFile3")) ??
        descriptor.get(PDFName.of("FontFile2")),
    ) as PDFRawStream;
    const embedded = fontkit.create(decodePDFRawStream(stream).decode());
    assert.equal(embedded.familyName, "SabuyText");
    assert.ok(embedded.numGlyphs > 10);
    await task.destroy();
  });
test("rejects text overflow rather than silently clipping", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  await assert.rejects(
    exportPdf(
      await doc.save(),
      [
        {
          id: "1",
          page: 0,
          x: 0,
          y: 0,
          width: 5,
          height: 10,
          text: "ข้อความยาว",
          size: 16,
          color: "#000000",
          align: "left",
        },
      ],
      font,
    ),
    /ล้น/,
  );
});

test("rejects signed PDF without modifying it", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.context.register(
    doc.context.obj({ Type: "Sig", ByteRange: [0, 1, 2, 3] }),
  );
  await assert.rejects(exportPdf(await doc.save(), [], font), /ลายเซ็น/);
});
test("glyph paths retain mark geometry from Sarabun shaping", async () => {
  const { createShapedFont } =
    await import("../src/SabuySign.Web/Client/editor/shaped-font.ts");
  const shaped = createShapedFont(font, ["กุ้ง ปู่ น้ำ กำ"]);
  const derived = fontkit.create(shaped.bytes);
  for (const text of ["กุ้", "ปู่", "น้ำ", "กำ"]) {
    const original = fontkit.create(font).layout(text);
    const glyph = derived.glyphForCodePoint(shaped.clusters.get(text)!.code);
    let advance = 0,
      minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    original.glyphs.forEach((g, i) => {
      const p = original.positions[i];
      minX = Math.min(minX, advance + p.xOffset + g.bbox.minX);
      maxX = Math.max(maxX, advance + p.xOffset + g.bbox.maxX);
      minY = Math.min(minY, p.yOffset + g.bbox.minY);
      maxY = Math.max(maxY, p.yOffset + g.bbox.maxY);
      advance += p.xAdvance;
    });
    for (const [actual, expected] of [
      [glyph.bbox.minX, minX],
      [glyph.bbox.maxX, maxX],
      [glyph.bbox.minY, minY],
      [glyph.bbox.maxY, maxY],
    ])
      assert.ok(
        Math.abs(actual - expected) < 2,
        `${text}: glyph geometry differs`,
      );
    assert.equal(glyph.advanceWidth, advance);
  }
});
test("rotated crop coordinate mapping matches PDF.js viewport with page user units", async () => {
  const { pagePoint } =
    await import("../src/SabuySign.Web/Client/editor/pdf.ts");
  for (const rotation of [0, 90, 180, 270]) {
    const doc = await PDFDocument.create();
    const p = doc.addPage([600, 800]);
    p.setCropBox(20, 30, 550, 720);
    p.setRotation(degrees(rotation));
    p.node.set(PDFName.of("UserUnit"), doc.context.obj(2));
    const task = getDocument({ data: await doc.save() });
    const loaded = await task.promise;
    const viewport = (await loaded.getPage(1)).getViewport({ scale: 1 });
    const point = pagePoint(p.getCropBox(), rotation, 50, 60);
    const actual = viewport.convertToViewportPoint(...point);
    assert.ok(Math.abs(actual[0] - 100) < 0.01);
    assert.ok(Math.abs(actual[1] - 120) < 0.01);
    await task.destroy();
  }
});

test("reopening an exported PDF preserves old text when adding a new font subset", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const box = (text: string, y: number): TextItem => ({
    id: text,
    page: 0,
    x: 40,
    y,
    width: 350,
    height: 40,
    text,
    size: 16,
    color: "#000000",
    align: "left",
  });
  const once = await exportPdf(
    await doc.save(),
    [box("กำ น้ำ สมชาย", 40)],
    font,
  );
  const twice = await exportPdf(once, [box("ผู้รับรอง Smith", 120)], font);
  const task = getDocument({ data: twice });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const text = content.items
    .filter((i): i is any => "str" in i)
    .map((i) => i.str)
    .join("");
  assert.equal(text, "กำ น้ำ สมชายผู้รับรอง Smith");
  await task.destroy();
});

test("rejects an oversized later page before opening the document", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([9000, 9000]);
  await assert.rejects(exportPdf(await doc.save(), [], font), /ขนาดหน้ากระดาษ/);
});

test("CropBox outside MediaBox uses the same visible intersection as PDF.js", async () => {
  const firstTransforms = [];
  for (const outside of [false, true]) {
    const d = await PDFDocument.create();
    const p = d.addPage([600, 800]);
    if (outside) p.setCropBox(-20, -30, 650, 900);
    const bytes = await exportPdf(
      await d.save(),
      [
        {
          id: "1",
          page: 0,
          x: 40,
          y: 40,
          width: 300,
          height: 40,
          text: "น้ำ",
          size: 16,
          color: "#000000",
          align: "left",
        },
      ],
      font,
    );
    const task = getDocument({ data: bytes });
    const content = await (
      await (await task.promise).getPage(1)
    ).getTextContent();
    firstTransforms.push(
      (content.items.find((i) => "str" in i) as any).transform,
    );
    await task.destroy();
  }
  assert.deepEqual(firstTransforms[0], firstTransforms[1]);
});

test("signature ink exports as visible vector strokes without replacing Thai text", async () => {
  const { Session } =
    await import("../src/SabuySign.Web/Client/editor/session.ts");
  const s = new Session();
  s.add(0, 40, 40);
  s.update(s.selected!, { text: "ผู้รับรอง น้ำ" });
  s.addSignature(0, 50, 120, {
    width: 100,
    height: 50,
    strokes: [
      [
        [8, 8],
        [90, 40],
      ],
    ],
  });
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const output = await exportPdf(await doc.save(), s.items, font);
  const loaded = await PDFDocument.load(output);
  const raw = loaded.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o) => o instanceof PDFRawStream)
    .map((o) =>
      new TextDecoder().decode(decodePDFRawStream(o as PDFRawStream).decode()),
    )
    .join("\n");
  assert.match(raw, /58 714 m/);
  assert.match(raw, /140 682 l/);
  assert.match(raw, /\nS\n/);
  const task = getDocument({ data: output });
  const content = await (
    await (await task.promise).getPage(1)
  ).getTextContent();
  assert.equal(
    content.items
      .filter((i): i is any => "str" in i)
      .map((i) => i.str)
      .join(""),
    "ผู้รับรอง น้ำ",
  );
  await task.destroy();
});

for (const rotation of [0, 90, 180, 270]) {
  test(`signature-only export matches crop/rotation/UserUnit viewport at ${rotation} degrees`, async () => {
    const { Session } =
      await import("../src/SabuySign.Web/Client/editor/session.ts");
    const { PDFNumber } = await import("pdf-lib");
    const document = await PDFDocument.create();
    const page = document.addPage([600, 800]);
    page.setCropBox(30, 40, 500, 700);
    page.setRotation(degrees(rotation));
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    const session = new Session();
    session.addSignature(0, 80, 100, {
      width: 100,
      height: 50,
      strokes: [
        [
          [8, 8],
          [90, 40],
        ],
      ],
    });
    const bytes = await exportPdf(await document.save(), session.items, font);
    const exported = await PDFDocument.load(bytes);
    const ink = exported.context
      .enumerateIndirectObjects()
      .filter(([, o]) => o instanceof PDFRawStream)
      .map(([, o]) =>
        new TextDecoder().decode(
          decodePDFRawStream(o as PDFRawStream).decode(),
        ),
      )
      .join("\n");
    const move = /([\d.]+) ([\d.]+) m/.exec(ink)!;
    const line = /([\d.]+) ([\d.]+) l/.exec(ink)!;
    const task = getDocument({ data: bytes });
    try {
      const viewport = (await (await task.promise).getPage(1)).getViewport({
        scale: 1,
      });
      assert.deepEqual(
        viewport.convertToViewportPoint(Number(move[1]), Number(move[2])),
        [88, 108],
      );
      assert.deepEqual(
        viewport.convertToViewportPoint(Number(line[1]), Number(line[2])),
        [170, 140],
      );
    } finally {
      await task.destroy();
    }
  });
}

test("rejects an automatically fitted text frame extending outside the PDF page", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  await assert.rejects(
    exportPdf(
      await doc.save(),
      [
        {
          id: "edge",
          page: 0,
          x: 580,
          y: 100,
          width: 100,
          height: 30,
          text: "ข้อความ",
          size: 16,
          color: "#000000",
          align: "left",
        },
      ],
      font,
    ),
    /ขอบหน้า/,
  );
});
