import fontkit, { type Font } from "@pdf-lib/fontkit";
import opentype from "opentype.js";
import { fontLicense } from "./font-license";

/** A grapheme can contain several Thai glyphs but must have one unambiguous
 * Unicode mapping. Build a document-specific OpenType font of shaped clusters.
 * PDF content remains text (Type0 font + ToUnicode), never page paths/images.
 * Rename the derived OFL font; do not use Sarabun's reserved font name.
 */
export function createShapedFont(fontBytes: Uint8Array, texts: string[]) {
  const source = fontkit.create(fontBytes) as Font;
  const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
  const segments = (text: string) =>
    [...segmenter.segment(text)].map((s) => s.segment);
  const clusters = new Map<string, { code: number; width: number }>();
  const glyphs = [
    new opentype.Glyph({
      name: ".notdef",
      advanceWidth: source.unitsPerEm,
      path: new opentype.Path(),
    }),
  ];
  for (const text of texts) {
    if (
      !/^[\u0020-\u007e\u00a0-\u024f\u0e01-\u0e5b\u2000-\u206f]*$/u.test(text)
    )
      throw new Error("รุ่นนี้รองรับข้อความภาษาไทยและอังกฤษเท่านั้น");
    for (const cluster of segments(text)) {
      if (clusters.has(cluster)) continue;
      if (clusters.size >= 6400)
        throw new Error("รูปแบบข้อความมากเกินขีดจำกัด กรุณาลดข้อความ");
      const run = source.layout(cluster);
      if (run.glyphs.some((g) => g.id === 0))
        throw new Error("ฟอนต์ Sarabun ไม่รองรับอักขระบางตัว");
      const path = new opentype.Path();
      let x = 0;
      run.glyphs.forEach((glyph, i) => {
        const p = run.positions[i];
        const dx = x + p.xOffset,
          dy = p.yOffset;
        for (const command of (
          glyph.path as unknown as {
            commands: { command: string; args: number[] }[];
          }
        ).commands) {
          const a = command.args;
          switch (command.command) {
            case "moveTo":
              path.moveTo(a[0] + dx, a[1] + dy);
              break;
            case "lineTo":
              path.lineTo(a[0] + dx, a[1] + dy);
              break;
            case "quadraticCurveTo":
              path.quadraticCurveTo(a[0] + dx, a[1] + dy, a[2] + dx, a[3] + dy);
              break;
            case "bezierCurveTo":
              path.curveTo(
                a[0] + dx,
                a[1] + dy,
                a[2] + dx,
                a[3] + dy,
                a[4] + dx,
                a[5] + dy,
              );
              break;
            case "closePath":
              path.close();
              break;
          }
        }
        x += p.xAdvance;
      });
      const code = 0xe000 + clusters.size;
      clusters.set(cluster, { code, width: x });
      glyphs.push(
        new opentype.Glyph({
          name: `cluster${clusters.size}`,
          unicode: code,
          advanceWidth: x,
          path,
        }),
      );
    }
  }
  const derived = new opentype.Font({
    familyName: "SabuyText",
    styleName: "Regular",
    unitsPerEm: source.unitsPerEm,
    ascender: source.ascent,
    descender: source.descent,
    glyphs,
    license: fontLicense,
    copyright: source.copyright ?? "Copyright 2018 The Sarabun Project Authors",
  });
  return {
    bytes: new Uint8Array(derived.toArrayBuffer()),
    source,
    clusters,
    segments,
    encode: (text: string) =>
      segments(text)
        .map((s) => String.fromCharCode(clusters.get(s)!.code))
        .join(""),
    width: (text: string, size: number) =>
      (segments(text).reduce((n, s) => n + clusters.get(s)!.width, 0) * size) /
      source.unitsPerEm,
  };
}
