import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = new URL(
  "./pdf.worker.min.mjs",
  import.meta.url,
).href;
export class SplitPreview {
  private task?: PDFDocumentLoadingTask;
  private pdf?: PDFDocumentProxy;
  private version = 0;
  private enlarged?: RenderTask;
  private groups: number[][] | null = null;
  private ready = false;
  private layoutKey = "";
  private cards: HTMLElement[] = [];
  private selected = new Set<number>();
  private busy = false;
  private buttons: HTMLButtonElement[] = [];
  private grid: HTMLElement;
  private note: HTMLElement;
  private dialog: HTMLDialogElement;
  private large: HTMLCanvasElement;
  constructor(
    private root: HTMLElement,
    private toggle: (index: number) => void,
    signal: AbortSignal,
  ) {
    this.grid = root.querySelector("[data-previews]")!;
    this.note = root.querySelector("[data-preview-status]")!;
    this.dialog = root.querySelector("[data-preview-dialog]")!;
    this.large = this.dialog.querySelector("canvas")!;
    this.dialog
      .querySelector("button")!
      .addEventListener("click", () => this.dialog.close(), { signal });
    this.dialog.addEventListener(
      "close",
      () => {
        this.enlarged?.cancel();
        this.large.width = this.large.height = 0;
      },
      { signal },
    );
  }
  sync(pages: number[], busy: boolean) {
    this.selected = new Set(pages);
    this.busy = busy;
    this.buttons.forEach((button, i) => {
      button.setAttribute("aria-pressed", String(this.selected.has(i)));
      button.disabled = busy;
    });
  }
  clear() {
    this.version++;
    this.ready = false;
    this.layoutKey = "";
    this.cards = [];
    this.enlarged?.cancel();
    this.dialog.close();
    void this.task?.destroy();
    this.task = undefined;
    this.pdf = undefined;
    this.grid.querySelectorAll("canvas").forEach((c) => {
      c.width = c.height = 0;
    });
    this.grid.replaceChildren();
    this.buttons = [];
    this.note.textContent = "";
  }
  async load(bytes: Uint8Array) {
    this.clear();
    const version = this.version;
    this.note.textContent = "กำลังสร้างภาพตัวอย่าง…";
    const options = {
      data: bytes.slice(),
      isEvalSupported: false,
      useSystemFonts: false,
      wasmUrl: new URL("./wasm/", import.meta.url).href,
      cMapUrl: new URL("./cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./standard_fonts/", import.meta.url).href,
    };
    const task = getDocument(options);
    this.task = task;
    try {
      const pdf = await task.promise;
      if (version !== this.version) return;
      this.pdf = pdf;
      for (let i = 0; i < pdf.numPages; i++) {
        const card = document.createElement("div");
        card.className = "split-page-card";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "split-page-toggle";
        button.setAttribute("aria-label", `เลือกหน้า ${i + 1}`);
        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = `หน้า ${i + 1}`;
        button.append(canvas, label);
        button.onclick = () => this.toggle(i);
        const zoom = document.createElement("button");
        zoom.type = "button";
        zoom.className = "split-page-zoom";
        zoom.textContent = "ขยายดู";
        zoom.setAttribute("aria-label", `ขยายหน้า ${i + 1}`);
        zoom.onclick = () => void this.show(i + 1);
        card.append(button, zoom);
        this.grid.append(card);
        this.cards.push(card);
        this.buttons.push(button);
      }
      this.sync([...this.selected], this.busy);
      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1);
        if (version !== this.version) return;
        const viewport = page.getViewport({ scale: 1 });
        const scaled = page.getViewport({
          scale: Math.min(320 / viewport.width, 440 / viewport.height),
        });
        const canvas = this.buttons[i].querySelector("canvas")!;
        canvas.width = Math.ceil(scaled.width);
        canvas.height = Math.ceil(scaled.height);
        await page.render({ canvas, viewport: scaled }).promise;
        if (version !== this.version) return;
        page.cleanup();
      }
      this.ready = true;
      this.layoutKey = "";
      this.layout(this.groups);
    } catch {
      if (version === this.version)
        this.note.textContent =
          "สร้างภาพตัวอย่างไม่สำเร็จ คุณยังระบุช่วงหน้าเพื่อแยกไฟล์ได้";
    }
  }
  layout(groups: number[][] | null) {
    this.groups = groups;
    if (!this.ready) return;
    const key = JSON.stringify(groups);
    if (this.layoutKey === key) return;
    this.layoutKey = key;
    this.grid.replaceChildren();
    this.grid.classList.toggle("show-ranges", groups !== null);
    this.note.textContent =
      groups === null
        ? "คลิกภาพเพื่อเลือกหน้า กดขยายดูเพื่ออ่านเอกสาร"
        : "ตรวจช่วงหน้าก่อนดาวน์โหลด · คลิกภาพเพื่อขยายดู";
    if (groups === null) {
      this.grid.append(...this.cards);
      return;
    }
    if (!groups.length) {
      const message = document.createElement("p");
      message.className = "split-empty-preview";
      message.textContent = "ระบุช่วงหน้าที่ถูกต้องเพื่อดูตัวอย่าง";
      this.grid.append(message);
      return;
    }
    groups.forEach((pages, i) => {
      const group = document.createElement("section"),
        title = document.createElement("h2"),
        strip = document.createElement("div");
      group.className = "split-preview-group";
      title.textContent = `ช่วงที่ ${i + 1}`;
      strip.className = "split-range-preview";
      const endpoints =
        pages.length === 1 ? [pages[0]] : [pages[0], pages.at(-1)!];
      endpoints.forEach((page, index) => {
        if (index === 1 && pages.length > 2) {
          const dots = document.createElement("span");
          dots.className = "split-range-dots";
          dots.textContent = "…";
          strip.append(dots);
        }
        const button = document.createElement("button"),
          canvas = document.createElement("canvas"),
          label = document.createElement("span");
        button.type = "button";
        button.className = "split-range-page split-page-zoom";
        button.setAttribute(
          "aria-label",
          `ขยายหน้า ${page + 1} ช่วงที่ ${i + 1}`,
        );
        const original = this.buttons[page].querySelector("canvas")!;
        canvas.width = original.width;
        canvas.height = original.height;
        canvas.getContext("2d")!.drawImage(original, 0, 0);
        label.textContent = String(page + 1);
        button.append(canvas, label);
        button.onclick = () => void this.show(page + 1);
        strip.append(button);
      });
      const count = document.createElement("p");
      count.textContent = `หน้า ${pages[0] + 1}–${pages.at(-1)! + 1} · ${pages.length} หน้า`;
      group.append(title, strip, count);
      this.grid.append(group);
    });
  }
  private async show(number: number) {
    const pdf = this.pdf,
      version = this.version;
    if (!pdf) return;
    const title = this.dialog.querySelector("h2")!;
    title.textContent = `ตัวอย่างหน้า ${number}`;
    this.dialog.showModal();
    try {
      const page = await pdf.getPage(number);
      if (version !== this.version || !this.dialog.open) return;
      const viewport = page.getViewport({ scale: 1 });
      const scaled = page.getViewport({
        scale: Math.min(1200 / viewport.width, 1600 / viewport.height),
      });
      this.large.width = Math.ceil(scaled.width);
      this.large.height = Math.ceil(scaled.height);
      this.enlarged = page.render({ canvas: this.large, viewport: scaled });
      await this.enlarged.promise;
    } catch {
      if (version === this.version && this.dialog.open)
        title.textContent = `เปิดภาพหน้า ${number} ไม่สำเร็จ`;
    }
  }
}
