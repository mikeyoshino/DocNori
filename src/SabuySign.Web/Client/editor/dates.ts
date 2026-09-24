export interface DateStamp {
  /** Gregorian civil date from the date picker; never parsed as UTC. */
  value: string;
  calendar: "buddhist" | "gregorian";
  format: "numeric" | "short" | "long";
}
const shortMonths = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];
const months = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
const pad = (value: number) => String(value).padStart(2, "0");
export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export function formatDate(stamp: DateStamp): string {
  const [year, month, day] = stamp.value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(stamp.value) ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    !["buddhist", "gregorian"].includes(stamp.calendar) ||
    !["numeric", "short", "long"].includes(stamp.format)
  )
    throw new Error("กรุณาเลือกวันที่ที่ถูกต้อง");
  const displayYear = year + (stamp.calendar === "buddhist" ? 543 : 0);
  if (stamp.format === "numeric")
    return `${pad(day)}/${pad(month)}/${displayYear}`;
  return `${day} ${(stamp.format === "short" ? shortMonths : months)[month - 1]} ${displayYear}`;
}
