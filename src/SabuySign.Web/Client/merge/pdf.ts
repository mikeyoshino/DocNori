import { PDFDocument } from "pdf-lib";
export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 100;
export const MAX_FILES = 20;
export async function readPdf(bytes: Uint8Array) {
  if (bytes.length > MAX_BYTES) throw new Error("ขนาดไฟล์เกิน 25 MB");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (!doc.getPageCount() || doc.getPageCount() > MAX_PAGES)
    throw new Error("รองรับ 1–100 หน้าต่อไฟล์");
  return doc;
}
export async function mergePdfs(inputs: Uint8Array[]) {
  if (inputs.length < 2 || inputs.length > MAX_FILES)
    throw new Error("กรุณาเลือก 2–20 ไฟล์");
  if (inputs.reduce((n, bytes) => n + bytes.length, 0) > MAX_BYTES)
    throw new Error("ขนาดรวมต้องไม่เกิน 25 MB");
  const result = await PDFDocument.create();
  for (const bytes of inputs) {
    const source = await readPdf(bytes);
    if (result.getPageCount() + source.getPageCount() > MAX_PAGES)
      throw new Error("จำนวนหน้ารวมต้องไม่เกิน 100 หน้า");
    // Preserve filled field appearances as page content when moving pages
    // into a new document (AcroForm fields belong to the source catalog).
    source.getForm().flatten({ updateFieldAppearances: false });
    for (const page of await result.copyPages(source, source.getPageIndices()))
      result.addPage(page);
  }
  return result.save();
}
