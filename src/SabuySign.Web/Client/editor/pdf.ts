import { penPath } from "../signatures/pen";
import { inkPath } from "../signatures/curves";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  moveTo,
  appendBezierCurve,
  closePath,
  fill,
  lineTo,
  stroke,
  setLineWidth,
  setLineCap,
  setLineJoin,
  LineJoinStyle,
  LineCapStyle,
  setStrokingRgbColor,
  type PDFPage,
  PDFName,
  PDFHexString,
  PDFString,
  PDFDict,
  beginText,
  endText,
  setFontAndSize,
  setTextMatrix,
  showText,
  setFillingRgbColor,
  pushGraphicsState,
  popGraphicsState,
} from "pdf-lib";
import { validateSignature } from "../signatures/data";
import type { TextItem } from "./session";
import { createShapedFont } from "./shaped-font";

function visibleCrop(page: PDFPage) {
  const crop = page.getCropBox(),
    media = page.getMediaBox();
  const x = Math.max(crop.x, media.x),
    y = Math.max(crop.y, media.y);
  const right = Math.min(crop.x + crop.width, media.x + media.width),
    top = Math.min(crop.y + crop.height, media.y + media.height);
  return right > x && top > y
    ? { x, y, width: right - x, height: top - y }
    : media;
}
export const LIMIT_BYTES = 25 * 1024 * 1024;
export const LIMIT_PAGES = 100;
export async function validatePdf(bytes: Uint8Array) {
  if (bytes.length > LIMIT_BYTES)
    throw new Error("ไฟล์ใหญ่เกิน 25 MB กรุณาใช้ไฟล์ที่เล็กลง");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.getPageCount() > LIMIT_PAGES)
    throw new Error("รุ่นนี้รองรับไม่เกิน 100 หน้า");
  for (const page of doc.getPages()) {
    const crop = visibleCrop(page);
    const unit = page.node.get(PDFName.of("UserUnit"));
    const scale =
      unit && "asNumber" in unit
        ? (unit as { asNumber(): number }).asNumber()
        : 1;
    const rotated = Math.abs(page.getRotation().angle % 180) === 90;
    const w = (rotated ? crop.height : crop.width) * scale;
    const h = (rotated ? crop.width : crop.height) * scale;
    if (
      ![w, h].every(Number.isFinite) ||
      w < 220 ||
      h < 80 ||
      w > 5000 ||
      h > 5000
    )
      throw new Error(
        "ขนาดหน้ากระดาษนี้ยังไม่รองรับ (กว้าง 220–5000 และสูง 80–5000 จุด)",
      );
  }
  // Includes signature dictionaries not reachable through a normal AcroForm tree.
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (
      obj instanceof PDFDict &&
      (obj.get(PDFName.of("ByteRange")) ||
        obj.get(PDFName.of("FT"))?.toString() === "/Sig")
    )
      throw new Error(
        "ยังไม่รองรับ PDF ที่มีช่องลายเซ็นดิจิทัล กรุณาใช้ต้นฉบับที่ไม่มีลายเซ็น",
      );
  }
  return doc;
}
export function pagePoint(
  crop: { x: number; y: number; width: number; height: number },
  rotation: number,
  x: number,
  y: number,
): [number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [crop.x + y, crop.y + x];
    case 180:
      return [crop.x + crop.width - x, crop.y + y];
    case 270:
      return [crop.x + crop.width - y, crop.y + crop.height - x];
    default:
      return [crop.x + x, crop.y + crop.height - y];
  }
}
const hex = (n: number) => n.toString(16).padStart(4, "0");
const unicodeHex = (codes: number[]) =>
  Array.from(String.fromCodePoint(...codes))
    .map((c) => {
      const n = c.codePointAt(0)!;
      if (n <= 0xffff) return hex(n);
      const u = n - 0x10000;
      return hex(0xd800 + (u >> 10)) + hex(0xdc00 + (u & 1023));
    })
    .join("");

/** Embed searchable shaped graphemes, preserving their exact source Unicode. */
export async function exportPdf(
  bytes: Uint8Array,
  items: TextItem[],
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  const doc = await validatePdf(bytes);
  if (!items.length) return bytes.slice();
  const textItems = items.filter((i) => !i.signature);
  if (!textItems.length) {
    for (const item of items) drawSignature(doc.getPages()[item.page], item);
    return doc.save();
  }
  const linesOf = (text: string) =>
    text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const shaped = createShapedFont(
    fontBytes,
    textItems.flatMap((i) => linesOf(i.text)),
  );
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(shaped.bytes, {
    subset: false,
    customName: "SabuyText",
  });
  for (const item of items) {
    const page = doc.getPages()[item.page];
    if (!page) throw new Error("ไม่พบหน้าเอกสาร");
    if (item.signature) {
      drawSignature(page, item);
      continue;
    }
    const lines = linesOf(item.text),
      lineHeight = item.size * 1.6;
    if (
      lines.length * lineHeight > item.height + 0.1 ||
      lines.some((l) => shaped.width(l, item.size) > item.width + 0.1)
    )
      throw new Error("ข้อความล้นกรอบ กรุณาลดขนาดตัวอักษรหรือขึ้นบรรทัดใหม่");
    const crop = visibleCrop(page),
      rotation = page.getRotation().angle;
    const unit = page.node.get(PDFName.of("UserUnit"));
    const userUnit =
      unit && "asNumber" in unit
        ? (unit as { asNumber(): number }).asNumber()
        : 1;
    const rotated = Math.abs(rotation % 180) === 90;
    const pageWidth = (rotated ? crop.height : crop.width) * userUnit;
    const pageHeight = (rotated ? crop.width : crop.height) * userUnit;
    if (
      item.x < 0 ||
      item.y < 0 ||
      item.x + item.width > pageWidth + 0.1 ||
      item.y + item.height > pageHeight + 0.1
    )
      throw new Error(
        "ข้อความเกินขอบหน้า กรุณาย้ายข้อความ ลดขนาดตัวอักษร หรือขึ้นบรรทัดใหม่",
      );
    const point = (x: number, y: number) =>
      pagePoint(crop, rotation, x / userUnit, y / userUnit);
    const [ox, oy] = point(0, 0),
      [rx, ry] = point(1, 0),
      [ux, uy] = point(0, -1);
    const name = page.node.newFontDictionary("SabuyText", font.ref);
    const rgb = item.color
      .match(/[a-f0-9]{2}/gi)
      ?.map((c) => parseInt(c, 16) / 255) ?? [0, 0, 0];
    page.pushOperators(
      pushGraphicsState(),
      beginText(),
      setFontAndSize(name, item.size),
      setFillingRgbColor(rgb[0], rgb[1], rgb[2]),
    );
    lines.forEach((line, index) => {
      const width = shaped.width(line, item.size);
      const align =
        item.align === "center"
          ? (item.width - width) / 2
          : item.align === "right"
            ? item.width - width
            : 0;
      const baseline =
        item.y +
        index * lineHeight +
        (lineHeight +
          ((shaped.source.ascent + shaped.source.descent) * item.size) /
            shaped.source.unitsPerEm) /
          2;
      const [x, y] = point(item.x + align, baseline);
      page.pushOperators(
        setTextMatrix(rx - ox, ry - oy, ux - ox, uy - oy, x, y),
        showText(font.encodeText(shaped.encode(line))),
      );
    });
    page.pushOperators(endText(), popGraphicsState());
  }
  // Override the synthetic cmap with source grapheme strings after embedding.
  // Each CID maps to a full Unicode grapheme, e.g. น้ำ, with no invisible filler.
  const mappings = [...shaped.clusters].map(
    ([text, { code }]) =>
      `<${font.encodeText(String.fromCharCode(code)).asString()}> <${unicodeHex([...text].map((c) => c.codePointAt(0)!))}>`,
  );
  let cmap =
    "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /SabuyUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
  for (let i = 0; i < mappings.length; i += 100) {
    const chunk = mappings.slice(i, i + 100);
    cmap += `${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar\n`;
  }
  cmap += "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
  await doc.flush();
  const dict = doc.context.lookup(font.ref, PDFDict);
  dict.set(
    PDFName.of("ToUnicode"),
    doc.context.register(doc.context.flateStream(cmap)),
  );
  return doc.save();
}

function drawSignature(page: PDFPage, item: TextItem) {
  if (!page || !item.signature) throw new Error("ไม่พบลายเซ็นหรือหน้าเอกสาร");
  const data = validateSignature(item.signature),
    crop = visibleCrop(page),
    rotation = page.getRotation().angle;
  const unit = page.node.get(PDFName.of("UserUnit"));
  const u =
    unit && "asNumber" in unit
      ? (unit as { asNumber(): number }).asNumber()
      : 1;
  const point = (x: number, y: number) =>
    pagePoint(
      crop,
      rotation,
      (item.x + (x * item.width) / data.width) / u,
      (item.y + (y * item.height) / data.height) / u,
    );
  page.pushOperators(
    pushGraphicsState(),
    setStrokingRgbColor(23 / 255, 36 / 255, 51 / 255),
    setFillingRgbColor(23 / 255, 36 / 255, 51 / 255),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
    setLineWidth((2.4 * item.width) / data.width / u),
  );
  for (const line of data.strokes) {
    for (const command of data.brush === "pen"
      ? penPath(line)
      : inkPath(line)) {
      page.pushOperators(
        command.kind === "M"
          ? moveTo(...point(...command.point))
          : command.kind === "L"
            ? lineTo(...point(...command.point))
            : appendBezierCurve(
                ...point(...command.first),
                ...point(...command.second),
                ...point(...command.point),
              ),
      );
    }
    if (data.brush === "pen") page.pushOperators(closePath(), fill());
    else page.pushOperators(stroke());
  }
  page.pushOperators(popGraphicsState());
}
