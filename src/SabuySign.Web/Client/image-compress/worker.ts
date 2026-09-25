import encodeJpeg, { init as initJpeg } from "@jsquash/jpeg/encode.js";
import initPng, { optimise } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import { chooseOutput, inspectInput, jpegOptions, type Quality } from "./core";
import { validateBatch } from "../image-tools/core";
self.onmessage = async ({
  data,
}: MessageEvent<{ file: File; quality: Quality; inspect?: boolean }>) => {
  let bitmap: ImageBitmap | undefined, canvas: OffscreenCanvas | undefined;
  try {
    validateBatch([data.file], 0, 0, "pdf");
    const original = new Uint8Array(await data.file.arrayBuffer()),
      info = inspectInput(original);
    if (data.inspect) {
      bitmap = await createImageBitmap(
        new Blob([original], { type: info.type }),
      );
      const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
      canvas = new OffscreenCanvas(
        Math.max(1, Math.round(bitmap.width * scale)),
        Math.max(1, Math.round(bitmap.height * scale)),
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("เบราว์เซอร์นี้ไม่รองรับการแปลงรูป");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      self.postMessage({
        blob: await canvas.convertToBlob({ type: info.type, quality: 0.85 }),
        width: bitmap.width,
        height: bitmap.height,
      });
      return;
    }
    let candidate: Uint8Array;
    if (info.type === "image/png") {
      await initPng(new URL("./codecs/oxipng.wasm", import.meta.url));
      // Optimise original PNG bytes instead of re-encoding through a canvas.
      // Single-threaded worker bounds CPU use and requires no cross-origin isolation.
      candidate = optimise(original, 2, false, false);
    } else {
      bitmap = await createImageBitmap(
        new Blob([original], { type: "image/jpeg" }),
      );
      if (bitmap.width * bitmap.height > 24_000_000)
        throw new Error("รองรับรูปไม่เกิน 24 ล้านพิกเซล");
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("เบราว์เซอร์นี้ไม่รองรับการแปลงรูป");
      ctx.drawImage(bitmap, 0, 0);
      await initJpeg({
        locateFile: () =>
          new URL("./codecs/mozjpeg.wasm", import.meta.url).href,
      });
      candidate = new Uint8Array(
        await encodeJpeg(
          ctx.getImageData(0, 0, bitmap.width, bitmap.height),
          jpegOptions(data.quality),
        ),
      );
    }
    const bytes = chooseOutput(original, candidate);
    self.postMessage({
      blob: new Blob([new Uint8Array(bytes)], { type: info.type }),
      unchanged: bytes === original,
      width: bitmap?.width ?? info.width,
      height: bitmap?.height ?? info.height,
    });
  } catch (e) {
    self.postMessage({
      error:
        e instanceof Error ? e.message : "ลดขนาดรูปไม่สำเร็จ กรุณาลองไฟล์อื่น",
    });
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 1;
  }
};
