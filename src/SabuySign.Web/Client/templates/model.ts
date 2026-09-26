import fontkit, { type Font } from "@pdf-lib/fontkit";
import type { TextItem } from "../editor/session";
export type Field = {
  id: string;
  label: string;
  type: "text" | "date" | "number";
  required: boolean;
  defaultValue: string;
};
export type Placement = Omit<TextItem, "text"> & {
  fieldId: string;
  multiline: boolean;
};
export type Definition = { fields: Field[]; placements: Placement[] };
export type Template = {
  id: string;
  name: string;
  version: number;
  definition: Definition;
  updatedAt?: string;
};
export const defaults = (d: Definition): Record<string, string> =>
  Object.fromEntries(d.fields.map((f) => [f.id, f.defaultValue ?? ""]));
const segments = new Intl.Segmenter("th", { granularity: "grapheme" });
export function makeMeasure(bytes: Uint8Array) {
  const font = fontkit.create(bytes) as Font;
  const cache = new Map<string, number>();
  return (text: string, size: number) => {
    let width = 0;
    for (const { segment } of segments.segment(text)) {
      if (!cache.has(segment)) {
        const run = font.layout(segment);
        if (run.glyphs.some((g) => g.id === 0))
          throw Error("รองรับข้อความภาษาไทยและอังกฤษ");
        cache.set(
          segment,
          run.positions.reduce((n, p) => n + p.xAdvance, 0),
        );
      }
      width += cache.get(segment)!;
    }
    return (width * size) / font.unitsPerEm;
  };
}
export function layout(
  d: Definition,
  values: Record<string, string>,
  measure: (text: string, size: number) => number,
) {
  const errors: Record<string, string> = Object.create(null);
  const items: TextItem[] = [];
  const invalid = new Set<string>();
  for (const f of d.fields) {
    const value = Object.hasOwn(values, f.id) ? values[f.id] : "";
    if (f.required && !value.trim()) errors[f.id] = "กรุณากรอก" + f.label;
    if (value.length > 10000) errors[f.id] = "ข้อความยาวเกินไป";
    if (
      value &&
      f.type === "number" &&
      (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ||
        !Number.isFinite(Number(value)))
    )
      errors[f.id] = "กรุณากรอกตัวเลข";
    if (
      value &&
      f.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      errors[f.id] = "วันที่ไม่ถูกต้อง";
  }
  for (const p of d.placements) {
    const f = d.fields.find((f) => f.id === p.fieldId);
    if (!f) continue;
    let text = Object.hasOwn(values, f.id) ? values[f.id] : "";
    if (f.type === "date" && text && !errors[f.id]) {
      const [y, m, day] = text.split("-");
      text = `${day}/${m}/${Number(y) + 543}`;
    }
    text = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    try {
      if (
        !/^[\u0020-\u007e\u00a0-\u024f\u0e01-\u0e5b\u2000-\u206f\n]*$/u.test(
          text,
        )
      )
        throw Error("รองรับข้อความภาษาไทยและอังกฤษ");
      let lines: string[] = [];
      for (const paragraph of text.split("\n")) {
        if (!p.multiline) {
          lines.push(paragraph);
          continue;
        }
        let line = "";
        for (const { segment } of segments.segment(paragraph)) {
          if (line && measure(line + segment, p.size) > p.width) {
            lines.push(line);
            line = "";
          }
          line += segment;
        }
        lines.push(line);
      }
      if (
        (!p.multiline && lines.length > 1) ||
        lines.length * p.size * 1.6 > p.height + 0.1 ||
        lines.some((l) => measure(l, p.size) > p.width + 0.1)
      ) {
        errors[f.id] = "ข้อความยาวเกินช่อง กรุณาลดข้อความ";
        invalid.add(p.id);
      }
      text = lines.join("\n");
    } catch (e) {
      errors[f.id] = (e as Error).message;
      invalid.add(p.id);
    }
    items.push({ ...p, text });
  }
  return { items, errors, invalid };
}
