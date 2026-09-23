import { getStroke } from "perfect-freehand";
import type { Point } from "./data";
import type { InkCommand } from "./curves";

/** A modest ballpoint brush: streamlining acts while dragging the mouse,
 * and distance-based simulated pressure gives the ink varying weight. */
export function penOutline(points: Point[], complete = true): Point[] {
  return getStroke(points, {
    size: 4,
    thinning: 0.55,
    smoothing: 0.7,
    streamline: 0.45,
    simulatePressure: true,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 5 },
    last: complete,
  }) as Point[];
}
const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
/** Closed outline, shared by the live canvas, SVG library and PDF fill. */
export function penPath(points: Point[], complete = true): InkCommand[] {
  const outline = penOutline(points, complete);
  if (!outline.length) return [];
  let from = mix(outline.at(-1)!, outline[0], 0.5);
  const commands: InkCommand[] = [{ kind: "M", point: from }];
  for (let i = 0; i < outline.length; i++) {
    const control = outline[i];
    const to = mix(control, outline[(i + 1) % outline.length], 0.5);
    commands.push({
      kind: "C",
      first: mix(from, control, 2 / 3),
      second: mix(to, control, 2 / 3),
      point: to,
    });
    from = to;
  }
  return commands;
}
