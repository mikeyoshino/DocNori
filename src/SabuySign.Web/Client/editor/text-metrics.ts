/** Baseline measured down from the top of a PDF text box, in PDF points. */
export function textBaseline(
  size: number,
  ascent: number,
  descent: number,
  unitsPerEm: number,
  line = 0,
) {
  return (
    line * size * 1.6 +
    (size * 1.6 + ((ascent + descent) * size) / unitsPerEm) / 2
  );
}
