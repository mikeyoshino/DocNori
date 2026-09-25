export type Mode = "pdf" | "heic";
export type Paper = "a4" | "letter" | "image";
export type Orientation = "auto" | "portrait" | "landscape";
export function validateBatch(
  files: { name: string; size: number }[],
  existing: number,
  bytes: number,
  mode: Mode,
) {
  if (files.length + existing > 20) throw new Error("เลือกได้สูงสุด 20 ไฟล์");
  const pattern = mode === "pdf" ? /\.(jpe?g|png)$/i : /\.(heic|heif)$/i;
  for (const f of files) {
    if (!pattern.test(f.name))
      throw new Error(
        mode === "pdf"
          ? "เลือกเฉพาะ JPG หรือ PNG"
          : "เลือกเฉพาะ HEIC หรือ HEIF",
      );
    if (!f.size || f.size > 20 * 1024 * 1024)
      throw new Error("แต่ละไฟล์ต้องไม่ว่างและมีขนาดไม่เกิน 20 MB");
  }
  if (bytes + files.reduce((s, f) => s + f.size, 0) > 100 * 1024 * 1024)
    throw new Error("ขนาดไฟล์รวมต้องไม่เกิน 100 MB");
}
export function checkPixels(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 20000 ||
    height > 20000 ||
    width * height > 50_000_000
  )
    throw new Error("รูปภาพใหญ่เกินไป รองรับสูงสุด 50 ล้านพิกเซล");
}
export function imageDimensions(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0,
    height = 0,
    type = "image/jpeg";
  if (
    b.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n) &&
    String.fromCharCode(...b.slice(12, 16)) === "IHDR"
  ) {
    width = v.getUint32(16);
    height = v.getUint32(20);
    type = "image/png";
  } else if (b[0] === 255 && b[1] === 216) {
    for (let i = 2; i + 8 < b.length;) {
      if (b[i++] !== 255) break;
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = v.getUint16(i);
      if (length < 2 || i + length > b.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = v.getUint16(i + 3);
        width = v.getUint16(i + 5);
        break;
      }
      i += length;
    }
  }
  if (!width || !height)
    throw new Error("เปิดรูปภาพไม่ได้ กรุณาเลือก JPG หรือ PNG ที่สมบูรณ์");
  checkPixels(width, height);
  return { width, height, type };
}
export function fitPage(
  w: number,
  h: number,
  paper: Paper,
  orientation: Orientation,
  margin: number,
) {
  checkPixels(w, h);
  if (
    !["a4", "letter", "image"].includes(paper) ||
    !["auto", "portrait", "landscape"].includes(orientation) ||
    ![0, 18, 36].includes(margin)
  )
    throw new Error("การตั้งค่ากระดาษไม่ถูกต้อง");
  let pageWidth = paper === "letter" ? 612 : 595.28,
    pageHeight = paper === "letter" ? 792 : 841.89;
  if (paper === "image") {
    pageWidth = w * 0.75;
    pageHeight = h * 0.75;
    margin = 0;
    const ratio = Math.min(1, 14400 / Math.max(pageWidth, pageHeight));
    pageWidth *= ratio;
    pageHeight *= ratio;
  } else if (orientation === "landscape" || (orientation === "auto" && w > h))
    [pageWidth, pageHeight] = [pageHeight, pageWidth];
  const ratio = Math.min(
      (pageWidth - 2 * margin) / w,
      (pageHeight - 2 * margin) / h,
    ),
    width = w * ratio,
    height = h * ratio;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}
export function uniqueJpgName(name: string, used: Set<string>) {
  const base =
    name.replace(/\.(heic|heif)$/i, "").replace(/[\\/\x00-\x1f]/g, "_") ||
    "image";
  let result = base + ".jpg",
    i = 2;
  while (used.has(result.toLowerCase())) result = `${base}-${i++}.jpg`;
  used.add(result.toLowerCase());
  return result;
}
