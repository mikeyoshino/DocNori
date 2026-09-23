import type { SignatureData } from "../signatures/data";
export interface TextItem {
  signature?: SignatureData;
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: number;
  color: string;
  align: "left" | "center" | "right";
}
export class Session {
  constructor(
    private readonly fitText: (item: TextItem) => TextItem = (item) => item,
  ) {}
  private current: TextItem[] = [];
  private past: TextItem[][] = [];
  private future: TextItem[][] = [];
  selected: string | null = null;
  revision = 0;
  get items() {
    return structuredClone(this.current);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  private commit(items: TextItem[]) {
    this.past.push(this.current);
    if (this.past.length > 100) this.past.shift();
    this.current = items.map((item) =>
      item.signature ? item : this.fitText(item),
    );
    this.future = [];
    this.revision++;
  }
  add(page: number, x: number, y: number) {
    const id = crypto.randomUUID();
    this.commit([
      ...this.current,
      {
        id,
        page,
        x,
        y,
        width: 220,
        height: 54,
        text: "ข้อความ",
        size: 16,
        color: "#172433",
        align: "left",
      },
    ]);
    this.selected = id;
  }
  update(id: string, patch: Partial<TextItem>) {
    const old = this.current.find((i) => i.id === id);
    if (!old) return;
    const next = { ...old, ...patch, id };
    if (JSON.stringify(old) === JSON.stringify(next)) return;
    this.commit(this.current.map((i) => (i.id === id ? next : i)));
  }
  addSignature(
    page: number,
    x: number,
    y: number,
    signature: SignatureData,
    placementWidth = Math.min(180, signature.width),
  ) {
    const id = crypto.randomUUID();
    const width = placementWidth;
    this.commit([
      ...this.current,
      {
        id,
        page,
        x,
        y,
        width,
        height: (width * signature.height) / signature.width,
        text: "",
        size: 2.4,
        color: "#172433",
        align: "left",
        signature: structuredClone(signature),
      },
    ]);
    this.selected = id;
  }
  remove(id: string) {
    if (!this.current.some((i) => i.id === id)) return;
    this.commit(this.current.filter((i) => i.id !== id));
    this.selected = null;
  }
  undo() {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.current);
    this.current = previous;
    this.selected = null;
    this.revision++;
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.current);
    this.current = next;
    this.selected = null;
    this.revision++;
  }
}
