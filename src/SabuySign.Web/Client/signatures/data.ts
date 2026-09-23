import { penPath } from "./pen";
import { inkPath } from "./curves";
export type Point = [number, number];
export interface SignatureData {
  brush?: "pen";
  width: number;
  height: number;
  strokes: Point[][];
}
export function validateSignature(value: unknown): SignatureData {
  const data = value as SignatureData;
  if (
    !data ||
    (data.brush !== undefined && data.brush !== "pen") ||
    !Number.isFinite(data.width) ||
    !Number.isFinite(data.height) ||
    data.width < 1 ||
    data.height < 1 ||
    data.width > 656 ||
    data.height > 256 ||
    !Array.isArray(data.strokes) ||
    !data.strokes.length ||
    data.strokes.length > 128
  )
    throw new Error("ลายเซ็นไม่ถูกต้อง กรุณาวาดใหม่");
  let count = 0;
  for (const stroke of data.strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2)
      throw new Error("กรุณาวาดลายเซ็นก่อนบันทึก");
    for (const point of stroke) {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every(Number.isFinite) ||
        point[0] < 0 ||
        point[1] < 0 ||
        point[0] > data.width ||
        point[1] > data.height
      )
        throw new Error("ลายเซ็นไม่ถูกต้อง");
      if (++count > 4096)
        throw new Error("ลายเซ็นมีรายละเอียดมากเกินไป กรุณาวาดใหม่");
    }
  }
  return {
    ...(data.brush ? { brush: data.brush } : {}),
    width: data.width,
    height: data.height,
    strokes: data.strokes.map((s) => s.map(([x, y]) => [x, y])),
  };
}
export function cropSignature(
  strokes: Point[][],
  brush?: "pen",
): SignatureData {
  const ink = strokes.filter((s) => s.length >= 2);
  const points = ink.flat();
  if (!points.length) throw new Error("กรุณาวาดลายเซ็นก่อนบันทึก");
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - 8,
    y = Math.min(...ys) - 8,
    width = Math.max(...xs) - x + 8,
    height = Math.max(...ys) - y + 8;
  if (width < 19 && height < 19) throw new Error("กรุณาวาดลายเซ็นก่อนบันทึก");
  return validateSignature({
    ...(brush ? { brush } : {}),
    width,
    height,
    strokes: ink.map((s) =>
      s.map(([px, py]) => [
        Math.round((px - x) * 100) / 100,
        Math.round((py - y) * 100) / 100,
      ]),
    ),
  });
}
export function signatureSvg(data: SignatureData): string {
  const valid = validateSignature(data);
  const paths = valid.strokes
    .map(
      (s) =>
        `<path d="${(valid.brush === "pen" ? penPath(s) : inkPath(s))
          .map((c) =>
            c.kind === "C"
              ? `C${c.first.join(" ")} ${c.second.join(" ")} ${c.point.join(" ")}`
              : `${c.kind}${c.point.join(" ")}`,
          )
          .join(" ")}${valid.brush === "pen" ? " Z" : ""}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${valid.width} ${valid.height}" fill="${valid.brush === "pen" ? "#172433" : "none"}" stroke="${valid.brush === "pen" ? "none" : "#172433"}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
