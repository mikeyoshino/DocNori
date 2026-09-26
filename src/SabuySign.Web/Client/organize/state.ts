export type OrganizePage = {
  id: string;
  sourceId: string | null;
  pageIndex: number;
  rotation: number;
};
export function movePage(pages: OrganizePage[], from: number, to: number) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= pages.length ||
    to >= pages.length
  )
    return pages;
  const next = [...pages];
  const [page] = next.splice(from, 1);
  next.splice(to, 0, page);
  return next;
}
export class PageHistory {
  pages: OrganizePage[] = [];
  private past: OrganizePage[][] = [];
  private future: OrganizePage[][] = [];
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  apply(pages: OrganizePage[]) {
    if (pages.length > 100) throw new Error("จัดเอกสารได้สูงสุด 100 หน้า");
    if (JSON.stringify(pages) === JSON.stringify(this.pages)) return;
    this.past.push(this.pages);
    if (this.past.length > 40) this.past.shift();
    this.pages = pages.map((p) => ({ ...p }));
    this.future = [];
  }
  undo() {
    if (this.canUndo) {
      this.future.push(this.pages);
      this.pages = this.past.pop()!;
    }
  }
  redo() {
    if (this.canRedo) {
      this.past.push(this.pages);
      this.pages = this.future.pop()!;
    }
  }
  clear() {
    this.pages = [];
    this.past = [];
    this.future = [];
  }
}
