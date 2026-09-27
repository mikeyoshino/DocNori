import fontkit, { type Font } from "@pdf-lib/fontkit";
import { textBaseline } from "../editor/text-metrics";
import type { TextItem } from "../editor/session";

/** The same shaped graphemes, advances and baseline as PDF export; only the UI adds opacity. */
export function createGhostRenderer(bytes: Uint8Array) {
  const font = fontkit.create(bytes) as Font;
  const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
  return (item: TextItem, scale: number) => {
    const canvas = document.createElement("canvas");
    canvas.className = "template-ghost";
    canvas.setAttribute("aria-hidden", "true");
    const ratio = Math.min(devicePixelRatio, 2);
    canvas.width = Math.max(1, Math.ceil(item.width * scale * ratio));
    canvas.height = Math.max(1, Math.ceil(item.height * scale * ratio));
    canvas.style.width = item.width * scale + "px";
    canvas.style.height = item.height * scale + "px";
    const context = canvas.getContext("2d")!;
    context.scale(scale * ratio, scale * ratio);
    context.fillStyle = item.color;
    const factor = item.size / font.unitsPerEm;
    item.text.split("\n").forEach((line, index) => {
      const runs = [...segmenter.segment(line)].map(({ segment }) =>
        font.layout(segment),
      );
      const width =
        runs.reduce(
          (sum, run) => sum + run.positions.reduce((n, p) => n + p.xAdvance, 0),
          0,
        ) * factor;
      const align =
        item.align === "center"
          ? (item.width - width) / 2
          : item.align === "right"
            ? item.width - width
            : 0;
      const baseline = textBaseline(
        item.size,
        font.ascent,
        font.descent,
        font.unitsPerEm,
        index,
      );
      let advance = 0;
      for (const run of runs) {
        run.glyphs.forEach((glyph, i) => {
          const position = run.positions[i];
          context.save();
          context.translate(
            align + (advance + position.xOffset) * factor,
            baseline - position.yOffset * factor,
          );
          context.scale(factor, -factor);
          context.fill(new Path2D(glyph.path.toSVG()));
          context.restore();
          advance += position.xAdvance;
        });
      }
    });
    return canvas;
  };
}
