// PDF text is positioned glyphs, not paragraphs. Rebuild readable lines without
// inventing words; adjacent Thai combining marks must remain adjacent.
export interface PositionedText {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
}
export interface TextLine {
  text: string;
  x: number;
  y: number;
  size: number;
}
export function textLines(items: PositionedText[]): TextLine[] {
  const rows: PositionedText[][] = [];
  for (const item of items
    .filter((i) => i.text && [i.x, i.y, i.width, i.size].every(Number.isFinite))
    .sort((a, b) => a.y - b.y || a.x - b.x)) {
    // Sorted baselines only need the current row; scanning all prior rows
    // would make large text PDFs quadratic.
    const current = rows.at(-1);
    const row =
      current &&
      Math.abs(current[0].y - item.y) <=
        Math.max(2, Math.min(current[0].size, item.size) * 0.25)
        ? current
        : undefined;
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      let text = "";
      let end = row[0].x;
      for (const item of row) {
        const gap = item.x - end;
        if (
          text &&
          !/\s$/.test(text) &&
          !/^\s|^[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/u.test(item.text) &&
          gap > Math.max(1, item.size * 0.15)
        )
          text += gap > item.size * 2 ? "\t" : " ";
        // PDF.js represents a wide column gap as a single space item.
        text +=
          /^ +$/.test(item.text) && item.width > item.size * 2
            ? "\t"
            : item.text;
        end = Math.max(end, item.x + item.width);
      }
      return {
        text: text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""),
        x: Math.min(...row.map((i) => i.x)),
        y: row[0].y,
        size: Math.max(...row.map((i) => i.size)),
      };
    })
    .filter((l) => l.text.trim());
}
// PDF.js infers spaces from glyph advances. A Thai mark can create a false
// advance. Remove only an inferred Thai-to-Thai gap that the matching original
// glyph run proves absent. Leave real spaces and Latin layout inference alone.
export function restoreThaiSpacing(extracted: string, original: string) {
  if (extracted.replace(/\s/g, "") !== original.replace(/\s/g, ""))
    return extracted;
  const spaces = new Set<number>();
  let offset = 0;
  for (const c of original) {
    if (/\s/.test(c)) spaces.add(offset);
    else offset++;
  }
  offset = 0;
  const chars = Array.from(extracted);
  return chars
    .filter((c, i) => {
      if (!/\s/.test(c)) {
        offset++;
        return true;
      }
      return (
        spaces.has(offset) ||
        !/[\u0e00-\u0e7f]/.test(chars[i - 1] ?? "") ||
        !/[\u0e00-\u0e7f]/.test(chars[i + 1] ?? "")
      );
    })
    .join("");
}
