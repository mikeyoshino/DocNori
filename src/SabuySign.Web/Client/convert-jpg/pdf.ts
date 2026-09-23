import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { checkDimensions, extractPageImages } from "./images";
import { MAX_BYTES, MAX_FILES, MAX_PAGES } from "../merge/pdf";
export type ConversionMode = "pages" | "images";
export type Quality = "normal" | "high";
export interface PdfInput {
  name: string;
  bytes: Uint8Array;
  pages: number;
}
export interface JpgOutput {
  name: string;
  bytes: Uint8Array;
}
GlobalWorkerOptions.workerSrc = new URL(
  "./pdf.worker.min.mjs",
  import.meta.url,
).href;
const MAX_OUTPUT = 100 * 1024 * 1024;
const MAX_IMAGES = 500;

async function jpeg(canvas: HTMLCanvasElement, quality: number) {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("สร้าง JPG ไม่สำเร็จ ลองใช้คุณภาพปกติ")),
      "image/jpeg",
      quality,
    ),
  );
  if (blob.type !== "image/jpeg")
    throw new Error("เบราว์เซอร์นี้ยังบันทึก JPG ไม่ได้");
  return new Uint8Array(await blob.arrayBuffer());
}
export async function convertToJpg(
  inputs: PdfInput[],
  mode: ConversionMode,
  quality: Quality,
  signal: AbortSignal,
  progress: (done: number, total: number, label: string) => void,
): Promise<JpgOutput[]> {
  if (!inputs.length || inputs.length > MAX_FILES)
    throw new Error("กรุณาเลือก 1–20 ไฟล์ PDF");
  const total = inputs.reduce((n, f) => n + f.pages, 0);
  if (
    total > MAX_PAGES ||
    inputs.reduce((n, f) => n + f.bytes.length, 0) > MAX_BYTES
  )
    throw new Error("รองรับรวมไม่เกิน 25 MB / 100 หน้า");
  const outputs: JpgOutput[] = [];
  let size = 0,
    done = 0;
  for (let fileIndex = 0; fileIndex < inputs.length; fileIndex++) {
    signal.throwIfAborted();
    const input = inputs[fileIndex];
    const options = {
      data: input.bytes.slice(),
      isEvalSupported: false,
      useSystemFonts: false,
      stopAtErrors: true,
      wasmUrl: new URL("./wasm/", import.meta.url).href,
      cMapUrl: new URL("./cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./standard_fonts/", import.meta.url).href,
    };
    const task = getDocument(options);
    const cancel = () => {
      void task.destroy();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const pdf = await task.promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        signal.throwIfAborted();
        progress(done, total, `${input.name} · หน้า ${n} / ${pdf.numPages}`);
        const page = await pdf.getPage(n);
        let imageNumber = 0;
        const save = async (canvas: HTMLCanvasElement) => {
          signal.throwIfAborted();
          if (outputs.length >= MAX_IMAGES)
            throw new Error(
              "พบรูปมากกว่า 500 รูป กรุณาแยกไฟล์ PDF แล้วลองอีกครั้ง",
            );
          const bytes = await jpeg(
            canvas,
            mode === "images" || quality === "high" ? 0.95 : 0.85,
          );
          signal.throwIfAborted();
          size += bytes.length;
          if (size > MAX_OUTPUT)
            throw new Error(
              "รูปภาพรวมมีขนาดเกิน 100 MB กรุณาแปลงครั้งละน้อยลงหรือเลือกคุณภาพปกติ",
            );
          imageNumber++;
          outputs.push({
            name: `document-${String(fileIndex + 1).padStart(2, "0")}-page-${String(n).padStart(3, "0")}${mode === "images" ? `-image-${String(imageNumber).padStart(3, "0")}` : ""}.jpg`,
            bytes,
          });
        };
        try {
          if (mode === "pages") {
            const viewport = page.getViewport({
              scale: (quality === "high" ? 300 : 150) / 72,
            });
            // Ignore floating-point noise at exact pixel boundaries (e.g. 450.00000000000006).
            const width = Math.ceil(viewport.width - 1e-8),
              height = Math.ceil(viewport.height - 1e-8);
            checkDimensions(width, height);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            try {
              await page.render({
                canvas,
                viewport,
                background: "rgb(255,255,255)",
              }).promise;
              await save(canvas);
            } finally {
              canvas.width = canvas.height = 0;
            }
          } else await extractPageImages(page, signal, save);
        } finally {
          page.cleanup();
        }
        progress(++done, total, `${input.name} · หน้า ${n} / ${pdf.numPages}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      await task.destroy();
    }
  }
  signal.throwIfAborted();
  if (!outputs.length)
    throw new Error(
      "ไม่พบรูปภาพที่ดึงออกได้ เอกสารนี้อาจมีเฉพาะข้อความหรือกราฟิก ลองเลือกแปลงทุกหน้าเป็น JPG",
    );
  return outputs;
}
