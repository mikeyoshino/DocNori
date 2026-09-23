import type { Point } from "./data";
export type InkCommand =
  | { kind: "M"; point: Point }
  | { kind: "L"; point: Point }
  | { kind: "C"; first: Point; second: Point; point: Point };
const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
/** Midpoint quadratics converted to cubics. Convex controls avoid overshoot,
 * preserve the captured endpoints, and give canvas/SVG/PDF identical ink. */
export function inkPath(points: Point[]): InkCommand[] {
  if (!points.length) return [];
  const commands: InkCommand[] = [{ kind: "M", point: points[0] }];
  if (points.length === 2)
    return [...commands, { kind: "L", point: points[1] }];
  if (points.length === 1) return commands;
  let from = points[0];
  for (let i = 0; i < points.length; i++) {
    const control = points[i];
    const to =
      i === points.length - 1 ? control : mix(control, points[i + 1], 0.5);
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
