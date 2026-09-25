import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFSignature,
} from "pdf-lib";
export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES = 100;
export const PRESETS = {
  high: { edge: 2400, quality: 0.88 },
  balanced: { edge: 1600, quality: 0.72 },
  small: { edge: 1000, quality: 0.5 },
} as const;
export type Quality = keyof typeof PRESETS;
export type ImageSize = { width: number; height: number };
export type Encoder = (
  bytes: Uint8Array,
  size: ImageSize,
  quality: Quality,
) => Promise<(ImageSize & { bytes: Uint8Array }) | undefined>;
export async function openPdf(bytes: Uint8Array) {
  if (bytes.length > MAX_BYTES)
    throw new Error("เลือกไฟล์ PDF ขนาดไม่เกิน 50 MB");
  if (!bytes.length) throw new Error("ไฟล์ PDF ว่างเปล่า");
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
  } catch {
    throw new Error("เปิด PDF ไม่ได้ กรุณาเลือกไฟล์ที่สมบูรณ์และไม่มีรหัสผ่าน");
  }
  if (doc.getPageCount() < 1 || doc.getPageCount() > MAX_PAGES)
    throw new Error("รองรับ PDF 1–100 หน้าต่อไฟล์");
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFDict
        ? object
        : object instanceof PDFRawStream
          ? object.dict
          : undefined;
    if (
      dict &&
      (dict.has(PDFName.of("ByteRange")) ||
        dict.lookup(PDFName.of("Type"))?.toString() === "/Sig" ||
        dict.lookup(PDFName.of("FT"))?.toString() === "/Sig")
    )
      throw new Error(
        "ไฟล์มีลายเซ็นดิจิทัล กรุณาใช้สำเนาที่ยังไม่ได้เซ็น เพื่อไม่ให้การรับรองเสียไป",
      );
  }
  const form = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (form?.has(PDFName.of("XFA")))
    throw new Error(
      "ไฟล์มีแบบฟอร์มพิเศษที่ยังไม่รองรับ กรุณาใช้สำเนา PDF แบบทั่วไป",
    );
  // Accessing getForm on an XFA file silently deletes its data in pdf-lib.
  // Reject it first, and do not create a new AcroForm on ordinary documents.
  if (
    doc.catalog.has(PDFName.of("Perms")) ||
    (form &&
      doc
        .getForm()
        .getFields()
        .some((f) => f instanceof PDFSignature))
  )
    throw new Error("ไฟล์มีลายเซ็นดิจิทัล กรุณาใช้สำเนาที่ยังไม่ได้เซ็น");
  return doc;
}
export function imageCandidate(stream: PDFRawStream): ImageSize | undefined {
  const d = stream.dict,
    value = (key: string) => d.lookup(PDFName.of(key))?.toString();
  if (
    value("Subtype") !== "/Image" ||
    value("Filter") !== "/DCTDecode" ||
    value("ColorSpace") !== "/DeviceRGB" ||
    value("BitsPerComponent") !== "8"
  )
    return;
  if (
    [
      "SMask",
      "Mask",
      "Decode",
      "DecodeParms",
      "ImageMask",
      "Alternates",
      "SMaskInData",
    ].some((k) => d.has(PDFName.of(k)))
  )
    return;
  const width = Number(value("Width")),
    height = Number(value("Height"));
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16000 ||
    height > 16000 ||
    width * height > 16_000_000 ||
    stream.getContents().length < 4096
  )
    return;
  return { width, height };
}
export async function compressPdf(
  bytes: Uint8Array,
  quality: Quality,
  encode: Encoder,
  progress: (done: number, total: number) => void = () => {},
) {
  if (!Object.hasOwn(PRESETS, quality))
    throw new Error("เลือกระดับการลดขนาดอีกครั้ง");
  const doc = await openPdf(bytes);
  const images = doc.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && imageCandidate(o));
  let optimizedImages = 0;
  for (const [i, [ref, object]] of images.entries()) {
    const original = object as PDFRawStream,
      size = imageCandidate(original)!;
    const replacement = await encode(original.getContents(), size, quality);
    if (
      replacement &&
      replacement.bytes.length < original.getContents().length &&
      replacement.width > 0 &&
      replacement.height > 0 &&
      replacement.width <= size.width &&
      replacement.height <= size.height
    ) {
      const dict = original.dict.clone();
      dict.set(PDFName.of("Width"), PDFNumber.of(replacement.width));
      dict.set(PDFName.of("Height"), PDFNumber.of(replacement.height));
      doc.context.assign(ref, PDFRawStream.of(dict, replacement.bytes));
      optimizedImages++;
    }
    progress(i + 1, images.length);
  }
  const output = await doc.save({
    useObjectStreams: true,
    updateFieldAppearances: false,
  });
  const smaller = output.length < bytes.length;
  return {
    bytes: smaller ? output : bytes,
    optimizedImages: smaller ? optimizedImages : 0,
    pages: doc.getPageCount(),
  };
}
