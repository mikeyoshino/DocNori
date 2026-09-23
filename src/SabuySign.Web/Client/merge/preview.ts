import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = new URL(
  "./pdf.worker.min.mjs",
  import.meta.url,
).href;
export async function cover(bytes: Uint8Array, signal: AbortSignal) {
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
  const cancel = () => {
    void task.destroy();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) return;
    const pdf = await task.promise,
      page = await pdf.getPage(1),
      initial = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(360 / initial.width, 480 / initial.height),
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.setAttribute("aria-hidden", "true");
    await page.render({ canvas, viewport }).promise;
    return canvas;
  } finally {
    signal.removeEventListener("abort", cancel);
    await task.destroy();
  }
}
