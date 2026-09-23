import { exportPdf } from "./pdf";
self.onmessage = async (event) => {
  try {
    const bytes = await exportPdf(
      event.data.bytes,
      event.data.items,
      event.data.font,
    );
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "ไม่สามารถสร้าง PDF ได้",
    });
  }
};
