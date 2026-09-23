import { PDFDocument } from "pdf-lib";
import { readPdf } from "../merge/pdf";
export function parsePages(value: string, count: number): number[] {
  if (!value.trim()) throw new Error("ระบุหน้าที่ต้องการ เช่น 1-3, 5");
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match)
      throw new Error("รูปแบบไม่ถูกต้อง ใช้เลขหน้าและช่วงหน้า เช่น 1-3, 5");
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > count)
      throw new Error(`ระบุหน้าระหว่าง 1–${count} และเรียงช่วงจากน้อยไปมาก`);
    for (let page = start; page <= end; page++) pages.add(page - 1);
  }
  return [...pages].sort((a, b) => a - b);
}
export async function splitPdf(
  bytes: Uint8Array,
  range: string,
  remaining = false,
) {
  const source = await readPdf(bytes);
  const selected = parsePages(range, source.getPageCount());
  const pages = remaining
    ? source.getPageIndices().filter((p) => !selected.includes(p))
    : selected;
  if (!pages.length) throw new Error("ไม่มีหน้าที่เหลือให้ดาวน์โหลด");
  source.getForm().flatten({ updateFieldAppearances: false });
  const output = await PDFDocument.create();
  for (const page of await output.copyPages(source, pages))
    output.addPage(page);
  return output.save();
}

export type PageRange = { start: number; end: number };
export function rangeGroups(ranges: PageRange[], count: number): number[][] {
  if (!ranges.length || ranges.length > 100)
    throw new Error("ระบุอย่างน้อย 1 ช่วง และไม่เกิน 100 ช่วง");
  const groups = ranges.map(({ start, end }) => {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < start ||
      end > count
    )
      throw new Error(
        `ระบุหน้าระหว่าง 1–${count} และให้หน้าสุดท้ายไม่น้อยกว่าหน้าแรก`,
      );
    return Array.from({ length: end - start + 1 }, (_, i) => start + i - 1);
  });
  if (groups.reduce((n, g) => n + g.length, 0) > 100)
    throw new Error("จำนวนหน้าที่ส่งออกรวมทุกช่วงต้องไม่เกิน 100 หน้า");
  return groups;
}
export function fixedRanges(count: number, size: number): PageRange[] {
  if (!Number.isInteger(size) || size < 1 || size > count)
    throw new Error(`ระบุจำนวนหน้าต่อไฟล์ระหว่าง 1–${count}`);
  return Array.from({ length: Math.ceil(count / size) }, (_, i) => ({
    start: i * size + 1,
    end: Math.min(count, (i + 1) * size),
  }));
}
export async function exportGroups(
  bytes: Uint8Array,
  groups: number[][],
  combine: boolean,
) {
  const source = await readPdf(bytes);
  if (
    !groups.length ||
    groups.some(
      (g) =>
        !g.length ||
        g.some(
          (p) => !Number.isInteger(p) || p < 0 || p >= source.getPageCount(),
        ),
    ) ||
    groups.reduce((n, g) => n + g.length, 0) > 100
  )
    throw new Error("ช่วงหน้าไม่ถูกต้อง หรือจำนวนหน้าที่ส่งออกเกิน 100 หน้า");
  source.getForm().flatten({ updateFieldAppearances: false });
  const outputs = combine
    ? [[...new Set(groups.flat())].sort((a, b) => a - b)]
    : groups;
  const files = [];
  for (const [index, pages] of outputs.entries()) {
    const pdf = await PDFDocument.create();
    for (const page of await pdf.copyPages(source, pages)) pdf.addPage(page);
    files.push({ name: `part-${index + 1}.pdf`, bytes: await pdf.save() });
  }
  return files;
}
