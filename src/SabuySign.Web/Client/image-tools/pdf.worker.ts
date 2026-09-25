import { PDFDocument } from "pdf-lib";
import {
  imageDimensions,
  checkPixels,
  fitPage,
  validateBatch,
  type Paper,
  type Orientation,
} from "./core";
async function normalized(file: File, rotation = 0, thumbnail = false) {
  const bytes = new Uint8Array(await file.arrayBuffer()),
    info = imageDimensions(bytes);
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: info.type }),
  );
  let canvas: OffscreenCanvas | undefined;
  try {
    checkPixels(bitmap.width, bitmap.height);
    const scale = Math.min(
      1,
      (thumbnail ? 240 : 4096) / Math.max(bitmap.width, bitmap.height),
    );
    const w = Math.max(1, Math.round(bitmap.width * scale)),
      h = Math.max(1, Math.round(bitmap.height * scale));
    const angle = ((rotation % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(angle))
      throw new Error("มุมหมุนไม่ถูกต้อง");
    canvas = new OffscreenCanvas(angle % 180 ? h : w, angle % 180 ? w : h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("เบราว์เซอร์ไม่รองรับ");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    const blob = await canvas.convertToBlob({
      type: thumbnail ? "image/jpeg" : info.type,
      quality: 0.95,
    });
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
    if (canvas) {
      canvas.width = canvas.height = 1;
    }
  }
}
self.onmessage = async ({
  data,
}: MessageEvent<{
  inspect?: boolean;
  files: { file: File; rotation: number }[];
  paper: Paper;
  orientation: Orientation;
  margin: number;
}>) => {
  try {
    validateBatch(
      data.files.map((f) => f.file),
      0,
      0,
      "pdf",
    );
    if (data.inspect) {
      self.postMessage(await normalized(data.files[0].file, 0, true));
      return;
    }
    const pdf = await PDFDocument.create();
    let total = 0;
    for (const [i, item] of data.files.entries()) {
      const n = await normalized(item.file, item.rotation),
        bytes = new Uint8Array(await n.blob.arrayBuffer());
      total += bytes.length;
      if (total > 100 * 1024 * 1024)
        throw new Error("ผลลัพธ์ใหญ่เกินไป กรุณาเลือกน้อยรูปลง");
      const image =
        n.blob.type === "image/png"
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes);
      const fit = fitPage(
          n.width,
          n.height,
          data.paper,
          data.orientation,
          data.margin,
        ),
        page = pdf.addPage([fit.pageWidth, fit.pageHeight]);
      page.drawImage(image, fit);
      self.postMessage({
        progress: `กำลังจัดหน้า ${i + 1} / ${data.files.length}`,
      });
    }
    const bytes = await pdf.save();
    if (bytes.length > 100 * 1024 * 1024)
      throw new Error("ผลลัพธ์ใหญ่เกินไป กรุณาเลือกน้อยรูปลง");
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "สร้าง PDF ไม่สำเร็จ",
    });
  }
};
