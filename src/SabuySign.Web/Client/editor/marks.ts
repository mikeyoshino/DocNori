export type MarkKind = "check" | "cross" | "circle";
export const isMark = (value: string): value is MarkKind =>
  ["check", "cross", "circle"].includes(value);
export function markLines(kind: MarkKind): [number, number][][] {
  if (kind === "check")
    return [
      [
        [5, 12],
        [9.5, 16.5],
        [19, 6.5],
      ],
    ];
  if (kind === "cross")
    return [
      [
        [6, 6],
        [18, 18],
      ],
      [
        [18, 6],
        [6, 18],
      ],
    ];
  return [
    Array.from(
      { length: 65 },
      (_, n) =>
        [
          12 + 8 * Math.cos((n * Math.PI) / 32),
          12 + 8 * Math.sin((n * Math.PI) / 32),
        ] as [number, number],
    ),
  ];
}
export function markSvg(kind: MarkKind) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markLines(
    kind,
  )
    .map(
      (line) =>
        `<polyline points="${line.map((p) => p.join(",")).join(" ")}"/>`,
    )
    .join("")}</svg>`;
}
