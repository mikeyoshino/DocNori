export type Size = "small" | "medium" | "large";
export const MAX_BYTES = 200_000_000;
export function validateVideo(
  bytes: number,
  duration: number,
  width: number,
  height: number,
) {
  if (!bytes || bytes > MAX_BYTES)
    throw new Error("เลือกวิดีโอขนาดไม่เกิน 200 MB นะครับ");
  if (![duration, width, height].every((v) => Number.isFinite(v) && v > 0))
    throw new Error("เปิดวิดีโอนี้ไม่ได้ ลองเลือกไฟล์ MP4 หรือ WebM อื่น");
  if (duration > 3600.1) throw new Error("เลือกวิดีโอที่ยาวไม่เกิน 1 ชั่วโมง");
}
export function settings(
  start: number,
  end: number,
  total: number,
  width: number,
  height: number,
  size: Size,
  smooth: boolean,
) {
  if (
    ![start, end, total, width, height].every(Number.isFinite) ||
    start < 0 ||
    end > total + 0.01 ||
    end <= start ||
    end - start > 30.01 ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("เลือกช่วงเริ่มและจบให้ถูกต้อง ไม่เกิน 30 วินาที");
  const edge = { small: 320, medium: 480, large: 720 }[size];
  if (!edge) throw new Error("กรุณาเลือกขนาดภาพ");
  const ratio = Math.min(1, edge / Math.max(width, height));
  return {
    start,
    duration: end - start,
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    fps: smooth ? 20 : 10,
  };
}
