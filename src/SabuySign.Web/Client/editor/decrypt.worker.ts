import { decryptPdf } from "./decrypt";
self.onmessage = async (
  event: MessageEvent<{ bytes: Uint8Array; password: string }>,
) => {
  try {
    const bytes = await decryptPdf(
      event.data.bytes,
      event.data.password,
      new URL("./codecs/qpdf.wasm", self.location.href).href,
    );
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNSUPPORTED";
    self.postMessage({
      error: ["PASSWORD", "PERMISSION", "LIMIT"].includes(code)
        ? code
        : "UNSUPPORTED",
    });
  } finally {
    event.data.password = "";
    event.data.bytes.fill(0);
    self.close();
  }
};
