import build from "docnori-heif";
import { checkPixels, validateBatch } from "./core";
// A CSP-compatible decoder in a disposable worker, isolated per input image.
self.onmessage = async ({ data }: MessageEvent<{ file: File }>) => {
  let images: ReturnType<
      InstanceType<ReturnType<typeof build>["HeifDecoder"]>["decode"]
    > = [],
    decoder: InstanceType<ReturnType<typeof build>["HeifDecoder"]> | undefined,
    lib: ReturnType<typeof build> | undefined;
  try {
    validateBatch([data.file], 0, 0, "heic");
    const bytes = await data.file.arrayBuffer();
    const header = new Uint8Array(bytes, 0, Math.min(64, bytes.byteLength));
    if (new TextDecoder().decode(header.slice(4, 8)) !== "ftyp")
      throw new Error("ไฟล์นี้ไม่ใช่ HEIC/HEIF ที่สมบูรณ์");
    lib = build();
    decoder = new lib.HeifDecoder();
    images = decoder.decode(bytes);
    if (!images.length)
      throw new Error(
        "เปิด HEIC ไม่ได้ ไฟล์อาจเสียหรือใช้รูปแบบที่ยังไม่รองรับ",
      );
    const image =
        images.find(
          (i) => typeof i.is_primary === "function" && i.is_primary(),
        ) ?? images[0],
      width = image.get_width(),
      height = image.get_height();
    checkPixels(width, height);
    const blank = new ImageData(width, height);
    for (let i = 3; i < blank.data.length; i += 4) blank.data[i] = 255;
    const pixels = await new Promise<ImageData>((resolve, reject) =>
      image.display(blank, (p) =>
        p ? resolve(p) : reject(new Error("อ่านรูปภาพไม่สำเร็จ")),
      ),
    );
    const canvas = new OffscreenCanvas(width, height),
      ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("เบราว์เซอร์ไม่รองรับ");
    ctx.putImageData(pixels, 0, 0);
    // Composite alpha onto white when producing an opaque JPEG.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.92,
    });
    canvas.width = canvas.height = 1;
    if (blob.type !== "image/jpeg" || blob.size > 100 * 1024 * 1024)
      throw new Error("สร้าง JPG ไม่สำเร็จ");
    self.postMessage({ blob, width, height });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "แปลงรูปไม่สำเร็จ",
    });
  } finally {
    for (const image of images) image.free();
    if (decoder?.decoder) lib?.heif_context_free(decoder.decoder);
  }
};
