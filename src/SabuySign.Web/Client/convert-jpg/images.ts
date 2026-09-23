import { ImageKind, OPS, type PDFPageProxy } from "pdfjs-dist";

export const MAX_PIXELS = 16_000_000;
export function checkDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > MAX_PIXELS
  )
    throw new Error(
      "ภาพมีขนาดใหญ่เกินไป ลองเลือกคุณภาพปกติหรือใช้ PDF ที่มีขนาดหน้าน้อยลง",
    );
}
interface Raster {
  width: number;
  height: number;
  kind: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}
export function rasterCanvas(image: Raster) {
  const { width, height } = image;
  checkDimensions(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  if (image.bitmap) context.drawImage(image.bitmap, 0, 0);
  else {
    const data = image.data;
    if (!data) throw new Error("อ่านข้อมูลรูปภาพใน PDF ไม่สำเร็จ");
    const rgba = new Uint8ClampedArray(width * height * 4);
    const expected =
      image.kind === ImageKind.GRAYSCALE_1BPP
        ? Math.ceil(width / 8) * height
        : width * height * (image.kind === ImageKind.RGB_24BPP ? 3 : 4);
    if (data.length < expected)
      throw new Error("ข้อมูลรูปภาพใน PDF ไม่ครบถ้วน");
    if (image.kind === ImageKind.RGBA_32BPP)
      rgba.set(data.subarray(0, rgba.length));
    else
      for (let p = 0; p < width * height; p++) {
        const out = p * 4;
        if (image.kind === ImageKind.RGB_24BPP) {
          rgba[out] = data[p * 3];
          rgba[out + 1] = data[p * 3 + 1];
          rgba[out + 2] = data[p * 3 + 2];
          rgba[out + 3] = 255;
        } else if (image.kind === ImageKind.GRAYSCALE_1BPP) {
          const x = p % width,
            y = Math.floor(p / width);
          const value =
            data[y * Math.ceil(width / 8) + (x >> 3)] & (128 >> (x & 7))
              ? 255
              : 0;
          rgba[out] = rgba[out + 1] = rgba[out + 2] = value;
          rgba[out + 3] = 255;
        } else
          throw new Error(
            "ยังอ่านรูปภาพชนิดนี้ไม่ได้ ลองใช้โหมดแปลงทุกหน้าเป็น JPG",
          );
      }
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
  }
  // JPEG has no alpha channel. Composite transparent pixels over white.
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";
  return canvas;
}
function getImage(
  page: PDFPageProxy,
  id: string,
  signal: AbortSignal,
): Promise<Raster> {
  signal.throwIfAborted();
  const objects = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      finish();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("อ่านรูปภาพใน PDF ไม่สำเร็จ กรุณาลองแปลงทั้งหน้า"));
    }, 15000);
    signal.addEventListener("abort", cancel, { once: true });
    objects.get(id, (image: Raster) => {
      finish();
      if (image) resolve(image);
      else reject(new Error("อ่านรูปภาพใน PDF ไม่สำเร็จ"));
    });
  });
}
export async function extractPageImages(
  page: PDFPageProxy,
  signal: AbortSignal,
  save: (canvas: HTMLCanvasElement) => Promise<void>,
) {
  const ops = await page.getOperatorList(),
    seen = new Set<string>();
  for (let i = 0; i < ops.fnArray.length; i++) {
    signal.throwIfAborted();
    const op = ops.fnArray[i],
      args = ops.argsArray[i];
    let image: Raster;
    if (op === OPS.paintImageXObject || op === OPS.paintImageXObjectRepeat) {
      const id = args[0] as string;
      if (seen.has(id)) continue;
      seen.add(id);
      image = await getImage(page, id, signal);
    } else if (
      op === OPS.paintInlineImageXObject ||
      op === OPS.paintInlineImageXObjectGroup
    )
      image = args[0] as Raster;
    else continue;
    const canvas = rasterCanvas(image);
    try {
      if (op === OPS.paintInlineImageXObjectGroup) {
        const regions = new Set<string>();
        for (const region of args[1] as {
          x: number;
          y: number;
          w: number;
          h: number;
        }[]) {
          const key = `${region.x},${region.y},${region.w},${region.h}`;
          if (regions.has(key)) continue;
          regions.add(key);
          checkDimensions(region.w, region.h);
          const crop = document.createElement("canvas");
          crop.width = region.w;
          crop.height = region.h;
          try {
            crop
              .getContext("2d")!
              .drawImage(
                canvas,
                region.x,
                region.y,
                region.w,
                region.h,
                0,
                0,
                region.w,
                region.h,
              );
            await save(crop);
          } finally {
            crop.width = crop.height = 0;
          }
        }
      } else await save(canvas);
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
}
