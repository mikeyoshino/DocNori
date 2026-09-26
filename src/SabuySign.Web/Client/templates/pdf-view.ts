import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = "/js/pdf.worker.min.mjs";
export class PdfView {
  task?: PDFDocumentLoadingTask;
  doc?: PDFDocumentProxy;
  render?: RenderTask;
  generation = 0;
  loadGeneration = 0;
  async load(bytes: Uint8Array) {
    const generation = ++this.loadGeneration;
    this.generation++;
    this.render?.cancel();
    const previous = this.task;
    this.task = undefined;
    this.doc = undefined;
    await previous?.destroy();
    if (generation !== this.loadGeneration) return;
    const options = {
      data: bytes.slice(),
      isEvalSupported: false,
      useSystemFonts: false,
      wasmUrl: "/js/wasm/",
      cMapUrl: "/js/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/js/standard_fonts/",
    };
    const task = (this.task = getDocument(options));
    const doc = await task.promise;
    if (generation !== this.loadGeneration) {
      await task.destroy();
      return;
    }
    this.doc = doc;
    return this.doc;
  }
  async draw(canvas: HTMLCanvasElement, page: number, maxWidth: number) {
    const generation = ++this.generation;
    this.render?.cancel();
    const doc = this.doc;
    if (!doc) return;
    const p = await doc.getPage(page + 1);
    if (generation !== this.generation) return;
    const unit = p.getViewport({ scale: 1 });
    const scale = Math.min(1.2, Math.max(0.2, maxWidth / unit.width));
    const ratio = Math.min(devicePixelRatio, 2);
    const viewport = p.getViewport({ scale: scale * ratio });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${unit.width * scale}px`;
    canvas.style.height = `${unit.height * scale}px`;
    this.render = p.render({ canvas, viewport });
    try {
      await this.render.promise;
    } catch (e) {
      if ((e as Error).name !== "RenderingCancelledException") throw e;
    }
    if (generation !== this.generation) return;
    return { width: unit.width, height: unit.height, scale };
  }
  async destroy() {
    this.loadGeneration++;
    this.generation++;
    this.render?.cancel();
    const task = this.task;
    this.task = undefined;
    this.doc = undefined;
    await task?.destroy();
  }
}
