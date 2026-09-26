import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import type { OrganizePage } from "./state";
GlobalWorkerOptions.workerSrc = new URL(
  "./pdf.worker.min.mjs",
  import.meta.url,
).href;
export class OrganizePreview {
  private docs = new Map<string, PDFDocumentProxy>();
  private tasks = new Set<PDFDocumentLoadingTask>();
  private thumbs = new Map<string, HTMLCanvasElement>();
  private rendering = new Set<RenderTask>();
  private version = 0;
  async load(id: string, bytes: Uint8Array, progress: (page: number) => void) {
    const version = this.version;
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
    this.tasks.add(task);
    try {
      const pdf = await task.promise;
      if (version !== this.version) return;
      this.docs.set(id, pdf);
      for (let index = 0; index < pdf.numPages; index++) {
        const page = await pdf.getPage(index + 1);
        if (version !== this.version) return;
        const view = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(300 / view.width, 400 / view.height),
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const render = page.render({ canvas, viewport });
        this.rendering.add(render);
        try {
          await render.promise;
        } finally {
          this.rendering.delete(render);
        }
        if (version !== this.version) {
          canvas.width = canvas.height = 0;
          return;
        }
        this.thumbs.set(`${id}:${index}`, canvas);
        page.cleanup();
        progress(index + 1);
      }
    } catch (error) {
      if (version === this.version) throw error;
    }
  }
  thumbnail(entry: OrganizePage) {
    const canvas = document.createElement("canvas"),
      original = this.thumbs.get(`${entry.sourceId}:${entry.pageIndex}`);
    const w = original?.width ?? 210,
      h = original?.height ?? 297,
      sideways = entry.rotation % 180 !== 0;
    canvas.width = sideways ? h : w;
    canvas.height = sideways ? w : h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (original) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((entry.rotation * Math.PI) / 180);
      ctx.drawImage(original, -w / 2, -h / 2);
    }
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
  }
  async enlarge(entry: OrganizePage, canvas: HTMLCanvasElement) {
    const pdf = entry.sourceId ? this.docs.get(entry.sourceId) : undefined;
    if (!pdf) {
      const thumb = this.thumbnail(entry);
      canvas.width = thumb.width;
      canvas.height = thumb.height;
      canvas.getContext("2d")!.drawImage(thumb, 0, 0);
      return;
    }
    const version = this.version,
      page = await pdf.getPage(entry.pageIndex + 1);
    if (version !== this.version) return;
    const base = page.getViewport({
      scale: 1,
      rotation: (page.rotate + entry.rotation) % 360,
    });
    const viewport = page.getViewport({
      scale: Math.min(1200 / base.width, 1600 / base.height),
      rotation: (page.rotate + entry.rotation) % 360,
    });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const render = page.render({ canvas, viewport });
    this.rendering.add(render);
    try {
      await render.promise;
    } finally {
      this.rendering.delete(render);
    }
  }
  clear() {
    this.version++;
    for (const render of this.rendering) render.cancel();
    this.rendering.clear();
    for (const task of this.tasks) void task.destroy().catch(() => {});
    this.tasks.clear();
    this.docs.clear();
    for (const canvas of this.thumbs.values()) canvas.width = canvas.height = 0;
    this.thumbs.clear();
  }
}
