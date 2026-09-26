import { PDFDocument, PDFPage, degrees } from "pdf-lib";
import { MAX_BYTES, MAX_FILES, MAX_PAGES, readPdf } from "../merge/pdf";
import type { OrganizePage } from "./state";
export type PdfSource = { id: string; bytes: Uint8Array };
export async function organizePdf(sources: PdfSource[], pages: OrganizePage[]) {
  if (!pages.length || pages.length > MAX_PAGES)
    throw new Error("เลือกอย่างน้อย 1 หน้า และไม่เกิน 100 หน้า");
  if (
    sources.length > MAX_FILES ||
    new Set(sources.map((s) => s.id)).size !== sources.length
  )
    throw new Error("เลือกได้สูงสุด 20 ไฟล์");
  if (sources.reduce((sum, s) => sum + s.bytes.length, 0) > MAX_BYTES)
    throw new Error("ขนาดรวมต้องไม่เกิน 25 MB");
  const documents = new Map<string, PDFDocument>();
  for (const source of sources) {
    if (!pages.some((p) => p.sourceId === source.id)) continue;
    const pdf = await readPdf(source.bytes);
    pdf.getForm().flatten({ updateFieldAppearances: false });
    documents.set(source.id, pdf);
  }
  const result = await PDFDocument.create();
  const templates = new Map<string, Map<number, PDFPage>>();
  for (const [id, source] of documents) {
    const indices = [
      ...new Set(
        pages.filter((p) => p.sourceId === id).map((p) => p.pageIndex),
      ),
    ];
    if (
      indices.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 0 ||
          index >= source.getPageCount(),
      )
    )
      throw new Error("ไม่พบหน้าต้นฉบับ");
    const copied = await result.copyPages(source, indices);
    templates.set(id, new Map(indices.map((index, i) => [index, copied[i]])));
  }
  for (const entry of pages) {
    if (!Number.isInteger(entry.rotation) || entry.rotation % 90 !== 0)
      throw new Error("มุมหมุนไม่ถูกต้อง");
    let page;
    if (entry.sourceId === null) page = result.addPage([595.28, 841.89]);
    else {
      const source = documents.get(entry.sourceId);
      if (
        !source ||
        !Number.isInteger(entry.pageIndex) ||
        entry.pageIndex < 0 ||
        entry.pageIndex >= source.getPageCount()
      )
        throw new Error("ไม่พบหน้าต้นฉบับ");
      // Share fonts/images across pages, but give each occurrence its own
      // page dictionary so rotating a duplicate cannot rotate its original.
      const template = templates.get(entry.sourceId)!.get(entry.pageIndex)!;
      const node = template.node.clone();
      page = PDFPage.of(node, result.context.register(node), result);
      result.addPage(page);
    }
    page.setRotation(
      degrees(
        (((page.getRotation().angle + entry.rotation) % 360) + 360) % 360,
      ),
    );
  }
  return result.save();
}
