import { penPath } from "./pen";
import { cropSignature, type Point, type SignatureData } from "./data";
export class SignaturePad {
  private strokes: Point[][] = [];
  private active: number | null = null;
  private observer: ResizeObserver;
  private abort = new AbortController();
  constructor(
    private canvas: HTMLCanvasElement,
    private changed: () => void,
  ) {
    const { signal } = this.abort;
    canvas.width = 1280;
    canvas.height = 480;
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (this.active !== null || this.strokes.length >= 128) return;
        e.preventDefault();
        this.active = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
        this.strokes.push([this.point(e)]);
        this.render();
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerId !== this.active) return;
        e.preventDefault();
        const samples = e.getCoalescedEvents?.() ?? [];
        for (const sample of samples) this.append(sample);
        this.append(e);
        this.render();
        this.changed();
      },
      { signal },
    );
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.active) return;
      if (e.type === "pointerup") this.append(e, true);
      this.active = null;
      this.strokes = this.strokes.filter((s) => s.length > 1);
      this.render();
      this.changed();
    };
    canvas.addEventListener("pointerup", end, { signal });
    canvas.addEventListener("pointercancel", end, { signal });
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(canvas);
    this.render();
  }
  private append(e: PointerEvent, endpoint = false) {
    const stroke = this.strokes.at(-1);
    if (!stroke) return;
    const point = this.point(e),
      last = stroke.at(-1)!;
    if (
      Math.hypot(point[0] - last[0], point[1] - last[1]) <
      (endpoint ? 0.01 : 0.5)
    )
      return;
    if (this.strokes.reduce((n, s) => n + s.length, 0) >= 4096) return;
    stroke.push(point);
  }
  private point(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(640, ((e.clientX - rect.left) * 640) / rect.width)),
      Math.max(0, Math.min(240, ((e.clientY - rect.top) * 240) / rect.height)),
    ];
  }
  private render() {
    const c = this.canvas.getContext("2d")!;
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.clearRect(0, 0, 640, 240);
    c.fillStyle = "#172433";
    for (const stroke of this.strokes) {
      c.beginPath();
      for (const command of penPath(
        stroke,
        this.active === null || stroke !== this.strokes.at(-1),
      )) {
        if (command.kind === "M") c.moveTo(...command.point);
        else if (command.kind === "L") c.lineTo(...command.point);
        else
          c.bezierCurveTo(
            ...command.first,
            ...command.second,
            ...command.point,
          );
      }
      c.closePath();
      c.fill();
    }
  }
  get empty() {
    return !this.strokes.some((s) => s.length > 1);
  }
  save(): SignatureData {
    return cropSignature(this.strokes, "pen");
  }
  clear() {
    this.strokes = [];
    this.active = null;
    this.render();
    this.changed();
  }
  undo() {
    this.active = null;
    this.strokes.pop();
    this.render();
    this.changed();
  }
  dispose() {
    this.abort.abort();
    this.observer.disconnect();
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.strokes = [];
  }
}
