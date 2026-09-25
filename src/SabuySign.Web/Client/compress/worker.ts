import {
  compressPdf,
  openPdf,
  PRESETS,
  type Encoder,
  type ImageSize,
  type Quality,
} from "./pdf";
// Check the JPEG's own frame dimensions before allocating decoded pixels.
function safeJpeg(bytes: Uint8Array, size: ImageSize) {
  if (bytes[0] !== 255 || bytes[1] !== 216) return false;
  for (let i = 2; i + 8 < bytes.length;) {
    if (bytes[i++] !== 255) return false;
    while (bytes[i] === 255) i++;
    const marker = bytes[i++];
    if (marker === 0xda || marker === 0xd9) return false;
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2 || i + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker))
      return (
        bytes[i + 2] === 8 &&
        bytes[i + 7] === 3 &&
        ((bytes[i + 3] << 8) | bytes[i + 4]) === size.height &&
        ((bytes[i + 5] << 8) | bytes[i + 6]) === size.width
      );
    i += length;
  }
  return false;
}
const encode: Encoder = async (bytes, size, quality) => {
  if (!safeJpeg(bytes, size)) return;
  let image: ImageBitmap | undefined, canvas: OffscreenCanvas | undefined;
  try {
    image = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
      { imageOrientation: "none", colorSpaceConversion: "none" },
    );
    const preset = PRESETS[quality],
      scale = Math.min(1, preset.edge / Math.max(size.width, size.height));
    const width = Math.max(1, Math.round(size.width * scale)),
      height = Math.max(1, Math.round(size.height * scale));
    canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: preset.quality,
    });
    if (blob.type !== "image/jpeg") return;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } catch {
    return;
  } finally {
    image?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
};
self.onmessage = async (
  event: MessageEvent<{
    bytes: Uint8Array;
    quality: Quality;
    inspect?: boolean;
  }>,
) => {
  try {
    if (event.data.inspect) {
      const doc = await openPdf(event.data.bytes);
      self.postMessage({ pages: doc.getPageCount() });
      return;
    }
    if (
      typeof OffscreenCanvas === "undefined" ||
      typeof createImageBitmap === "undefined"
    )
      throw new Error(
        "เบราว์เซอร์นี้ยังไม่รองรับการลดขนาดรูปภาพ กรุณาอัปเดตเบราว์เซอร์แล้วลองใหม่",
      );
    const result = await compressPdf(
      event.data.bytes,
      event.data.quality,
      encode,
      (done, total) =>
        self.postMessage({ progress: Math.round((done / total) * 90) }),
    );
    self.postMessage(result, { transfer: [result.bytes.buffer] });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "ลดขนาดไม่สำเร็จ กรุณาลองใหม่",
    });
  }
};
