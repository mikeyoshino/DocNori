import {
  getDocument,
  GlobalWorkerOptions,
  Util,
  OPS,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import {
  Document,
  Paragraph,
  TextRun,
  Tab,
  ImageRun,
  Packer,
  SectionType,
  type ISectionOptions,
} from "docx";
import { extractPageImages, checkDimensions } from "../convert-jpg/images";
import { textLines, restoreThaiSpacing, type PositionedText } from "./layout";
GlobalWorkerOptions.workerSrc = new URL(
  "./pdf.worker.min.mjs",
  import.meta.url,
).href;
export interface WordInput {
  name: string;
  bytes: Uint8Array;
  pages: number;
  imagePages: number[];
}
const MAX_OUTPUT = 100 * 1024 * 1024;
async function withPdf<T>(
  bytes: Uint8Array,
  signal: AbortSignal,
  action: (pdf: PDFDocumentProxy) => Promise<T>,
) {
  signal.throwIfAborted();
  const options = {
    data: bytes.slice(),
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
    return await action(await task.promise);
  } finally {
    signal.removeEventListener("abort", cancel);
    await task.destroy();
  }
}
async function positioned(page: PDFPageProxy) {
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  if (content.items.length > 50000)
    throw new Error("ข้อความในหน้านี้มีมากเกินไป กรุณาแยกไฟล์แล้วลองอีกครั้ง");
  const items: PositionedText[] = [];
  const originals = new Map<string, string | null>();
  if (
    content.items.some(
      (item) => "str" in item && /[\u0e00-\u0e7f]/.test(item.str),
    )
  ) {
    const ops = await page.getOperatorList();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.showText) continue;
      const glyphs = ops.argsArray[i][0] as (number | { unicode?: string })[];
      const original = glyphs
        .map((g) => (typeof g === "object" ? (g.unicode ?? "") : ""))
        .join("");
      const key = original.replace(/\s/g, "");
      if (originals.has(key) && originals.get(key) !== original)
        originals.set(key, null);
      else originals.set(key, original);
    }
  }
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const t = Util.transform(viewport.transform, item.transform);
    items.push({
      text: restoreThaiSpacing(
        item.str,
        originals.get(item.str.replace(/\s/g, "")) ?? item.str,
      ),
      x: t[4],
      y: t[5],
      width: item.width * viewport.scale,
      size: Math.hypot(t[2], t[3]),
    });
  }
  return { lines: textLines(items), viewport };
}
export async function inspectWord(bytes: Uint8Array, signal: AbortSignal) {
  return withPdf(bytes, signal, async (pdf) => {
    const imagePages: number[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      signal.throwIfAborted();
      const p = await pdf.getPage(n);
      try {
        const { lines } = await positioned(p);
        if (!lines.some((l) => /[\p{L}\p{N}]/u.test(l.text)))
          imagePages.push(n);
      } finally {
        p.cleanup();
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    return imagePages;
  });
}
async function png(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("สร้างรูปภาพใน Word ไม่สำเร็จ")),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
export async function convertToWord(
  inputs: WordInput[],
  signal: AbortSignal,
  progress: (done: number, total: number, label: string) => void,
) {
  const outputs: { name: string; bytes: Uint8Array }[] = [];
  const total = inputs.reduce((s, e) => s + e.pages, 0);
  if (
    !inputs.length ||
    inputs.length > 20 ||
    total > 100 ||
    inputs.reduce((s, e) => s + e.bytes.length, 0) > 25 * 1024 * 1024
  )
    throw new Error("รองรับ 1–20 ไฟล์ รวมไม่เกิน 25 MB / 100 หน้า");
  let done = 0,
    outputSize = 0,
    mediaSize = 0,
    characters = 0;
  for (let f = 0; f < inputs.length; f++) {
    const input = inputs[f];
    const sections: ISectionOptions[] = [];
    await withPdf(input.bytes, signal, async (pdf) => {
      for (let n = 1; n <= pdf.numPages; n++) {
        signal.throwIfAborted();
        progress(done, total, `${input.name} · หน้า ${n} / ${pdf.numPages}`);
        const page = await pdf.getPage(n);
        try {
          const { lines, viewport } = await positioned(page);
          const width = viewport.width,
            height = viewport.height;
          if (width > 1584 || height > 1584)
            throw new Error(
              "หน้ากระดาษใหญ่เกินขนาดที่ Word รองรับ กรุณาใช้ PDF ขนาดไม่เกิน 22 นิ้ว",
            );
          const margin = Math.min(36, width * 0.08, height * 0.08),
            availableWidth = width - margin * 2,
            availableHeight = height - margin * 2;
          const children: Paragraph[] = [];
          const image = async (canvas: HTMLCanvasElement, fullPage = false) => {
            signal.throwIfAborted();
            const bytes = await png(canvas);
            mediaSize += bytes.length;
            if (mediaSize > MAX_OUTPUT)
              throw new Error("รูปภาพรวมเกิน 100 MB กรุณาแปลงครั้งละน้อยลง");
            const scale = Math.min(
              availableWidth / canvas.width,
              (fullPage ? availableHeight - 6 : availableHeight * 0.65) /
                canvas.height,
              1,
            );
            children.push(
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new ImageRun({
                    type: "png",
                    data: bytes,
                    transformation: {
                      width: (canvas.width * scale * 96) / 72,
                      height: (canvas.height * scale * 96) / 72,
                    },
                    altText: {
                      title: fullPage ? `หน้า ${n} จาก PDF` : "รูปภาพจาก PDF",
                      description: fullPage
                        ? "หน้านี้เป็นรูปภาพ ไม่สามารถแก้ข้อความโดยไม่ใช้ OCR"
                        : "รูปภาพที่อยู่ในเอกสาร",
                      name: `page-${n}`,
                    },
                  }),
                ],
              }),
            );
          };
          if (input.imagePages.includes(n)) {
            const view = page.getViewport({ scale: 150 / 72 });
            const w = Math.ceil(view.width),
              h = Math.ceil(view.height);
            checkDimensions(w, h);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            try {
              await page.render({ canvas, viewport: view, background: "#fff" })
                .promise;
              await image(canvas, true);
            } finally {
              canvas.width = canvas.height = 0;
            }
          } else {
            const left = Math.min(...lines.map((l) => l.x));
            for (const line of lines) {
              characters += line.text.length;
              if (characters > 1_000_000)
                throw new Error(
                  "ข้อความในเอกสารมีมากเกินไป กรุณาแยกไฟล์แล้วลองอีกครั้ง",
                );
              children.push(
                new Paragraph({
                  spacing: { before: 0, after: 0 },
                  indent: {
                    left: Math.round(
                      Math.max(
                        0,
                        Math.min(line.x - left, availableWidth * 0.7),
                      ) * 20,
                    ),
                  },
                  children: [
                    new TextRun({
                      children: line.text
                        .split("\t")
                        .flatMap((part, i) => (i ? [new Tab(), part] : [part])),
                      font: {
                        ascii: "Sarabun",
                        hAnsi: "Sarabun",
                        eastAsia: "Sarabun",
                        cs: "Sarabun",
                      },
                      size: Math.round(
                        Math.max(8, Math.min(line.size, 36)) * 2,
                      ),
                      sizeComplexScript: Math.round(
                        Math.max(8, Math.min(line.size, 36)) * 2,
                      ),
                      language: {
                        value: "th-TH",
                        eastAsia: "th-TH",
                        bidirectional: "th-TH",
                      },
                    }),
                  ],
                }),
              );
            }
            // Keep embedded photos in editable-text documents. PDF vector artwork/table
            // borders are not Word objects; the UI explains the layout limitation.
            await extractPageImages(page, signal, (c) => image(c));
          }
          sections.push({
            properties: {
              type: SectionType.NEXT_PAGE,
              page: {
                size: {
                  width: Math.round(width * 20),
                  height: Math.round(height * 20),
                },
                margin: {
                  top: margin * 20,
                  right: margin * 20,
                  bottom: margin * 20,
                  left: margin * 20,
                },
              },
            },
            children: children.length ? children : [new Paragraph("")],
          });
        } finally {
          page.cleanup();
        }
        progress(++done, total, `${input.name} · หน้า ${n} / ${pdf.numPages}`);
        await new Promise((r) => setTimeout(r, 0));
      }
    });
    signal.throwIfAborted();
    const doc = new Document({
      creator: "DocNory",
      title: "Converted PDF",
      description: "Converted locally by DocNory",
      sections,
    });
    const bytes = new Uint8Array(await Packer.toArrayBuffer(doc));
    signal.throwIfAborted();
    outputSize += bytes.length;
    if (outputSize > MAX_OUTPUT)
      throw new Error("ผลลัพธ์รวมเกิน 100 MB กรุณาแปลงครั้งละน้อยลง");
    outputs.push({
      name: `document-${String(f + 1).padStart(2, "0")}.docx`,
      bytes,
    });
  }
  return outputs;
}
