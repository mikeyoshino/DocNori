import fontkit, { type Font } from "@pdf-lib/fontkit";
import type { TextItem } from "./session";

/** Fit both the browser's shaping and the grapheme advances used by PDF export. */
export function createTextFitter(bytes: Uint8Array) {
  const font = fontkit.create(bytes) as Font;
  const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
  const advances = new Map<string, number>();
  const canvas = document.createElement("canvas").getContext("2d")!;
  return (item: TextItem): TextItem => {
    const lines = item.text
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, "    ")
      .split("\n");
    canvas.font = `${item.size}px Sarabun`;
    const widths = lines.map((line) => {
      let advance = 0;
      for (const { segment } of segmenter.segment(line)) {
        if (!advances.has(segment)) {
          advances.set(
            segment,
            font.layout(segment).positions.reduce((n, p) => n + p.xAdvance, 0),
          );
        }
        advance += advances.get(segment)!;
      }
      return Math.max(
        canvas.measureText(line).width,
        (advance * item.size) / font.unitsPerEm,
      );
    });
    return {
      ...item,
      width: Math.max(16, Math.ceil(Math.max(...widths)) + 2),
      height: Math.ceil(lines.length * item.size * 1.6) + 2,
    };
  };
}
