import { readPdf } from "../merge/pdf";
import { organizePdf, type PdfSource } from "./pdf";
import type { OrganizePage } from "./state";
self.onmessage = async ({
  data,
}: MessageEvent<{
  inspect?: Uint8Array;
  sources: PdfSource[];
  pages: OrganizePage[];
}>) => {
  try {
    if (data.inspect) {
      const pdf = await readPdf(data.inspect);
      self.postMessage({ count: pdf.getPageCount() });
    } else {
      const bytes = await organizePdf(data.sources, data.pages);
      self.postMessage({ bytes }, { transfer: [bytes.buffer] });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    self.postMessage({
      error: /encrypted/i.test(message)
        ? "ไฟล์นี้มีรหัสผ่าน กรุณาปลดล็อกไฟล์ก่อนเลือกอีกครั้ง"
        : /[ก-๙]/.test(message)
          ? message
          : "อ่านไฟล์ PDF ไม่สำเร็จ กรุณาตรวจสอบว่าไฟล์เปิดได้ แล้วลองอีกครั้ง",
    });
  }
};
