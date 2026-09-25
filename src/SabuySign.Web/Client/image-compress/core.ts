import { imageDimensions } from "../image-tools/core";
export type Quality = "high" | "balanced" | "small";
export function jpegOptions(quality: string) {
  if (!["high", "balanced", "small"].includes(quality))
    throw new Error("เลือกคุณภาพไม่ถูกต้อง");
  return {
    quality: quality === "high" ? 94 : quality === "balanced" ? 88 : 80,
    auto_subsample: false,
    chroma_subsample: quality === "small" ? 2 : 1,
    progressive: true,
    optimize_coding: true,
  };
}
export function chooseOutput(original: Uint8Array, candidate: Uint8Array) {
  return candidate.length > 0 && candidate.length < original.length
    ? candidate
    : original;
}
export function inspectInput(bytes: Uint8Array) {
  const info = imageDimensions(bytes);
  if (info.width * info.height > 24_000_000)
    throw new Error("รองรับรูปไม่เกิน 24 ล้านพิกเซล กรุณาใช้รูปขนาดเล็กลง");
  if (info.type === "image/png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = false;
    for (let p = 8; p < bytes.length;) {
      if (p + 12 > bytes.length) throw new Error("ไฟล์ PNG ไม่สมบูรณ์");
      const n = view.getUint32(p),
        type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
      if (p + n + 12 > bytes.length) throw new Error("ไฟล์ PNG ไม่สมบูรณ์");
      if (type === "acTL") throw new Error("ยังไม่รองรับ PNG ภาพเคลื่อนไหว");
      p += n + 12;
      if (type === "IEND") {
        end = true;
        break;
      }
    }
    if (!end) throw new Error("ไฟล์ PNG ไม่สมบูรณ์");
  }
  return info;
}
