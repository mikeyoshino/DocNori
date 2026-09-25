export const MAX_FILES = 10;
export function validateWord(file: { name: string; size: number }) {
  if (!/\.(doc|docx)$/i.test(file.name))
    return "เลือกไฟล์ Word นามสกุล DOC หรือ DOCX";
  if (file.size === 0) return "ไฟล์นี้ว่างเปล่า กรุณาเลือกไฟล์ใหม่";
  if (file.size > 50_000_000) return "ไฟล์ต้องมีขนาดไม่เกิน 50 MB";
  return "";
}
export function pdfName(name: string, used: Set<string>) {
  const base =
    name.replace(/\.(doc|docx)$/i, "").replace(/[\x00-\x1f/\\]/g, "_") ||
    "document";
  let candidate = base + ".pdf",
    count = 2;
  while (used.has(candidate.toLowerCase()))
    candidate = `${base} (${count++}).pdf`;
  used.add(candidate.toLowerCase());
  return candidate;
}
