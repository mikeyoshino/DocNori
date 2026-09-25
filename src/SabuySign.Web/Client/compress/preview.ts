import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = new URL(
  "./pdf.worker.min.mjs",
  import.meta.url,
).href;
export class Preview {
  private task?: ReturnType<typeof getDocument>;
  private generation = 0;
  constructor(private host: HTMLElement) {}
  async show(bytes: Uint8Array, pageNumber: number) {
    const generation = ++this.generation;
    await this.task?.destroy();
    if (generation !== this.generation) return;
    const options = {
      data: bytes.slice(),
      isEvalSupported: false,
      useSystemFonts: false,
      maxImageSize: 16_000_000,
      wasmUrl: new URL("./wasm/", import.meta.url).href,
      cMapUrl: new URL("./cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./standard_fonts/", import.meta.url).href,
    };
    const task = (this.task = getDocument(options));
    try {
      const doc = await task.promise,
        page = await doc.getPage(pageNumber),
        initial = page.getViewport({ scale: 1 });
      const scale = Math.min(1000 / initial.width, 1200 / initial.height);
      const viewport = page.getViewport({ scale }),
        canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute("aria-label", `ตัวอย่างหน้า ${pageNumber}`);
      canvas.setAttribute("role", "img");
      await page.render({ canvas, viewport }).promise;
      if (generation === this.generation) this.host.replaceChildren(canvas);
    } finally {
      await task.destroy();
      if (this.task === task) this.task = undefined;
    }
  }
  clear() {
    this.generation++;
    void this.task?.destroy();
    this.task = undefined;
    this.host.replaceChildren();
  }
}
