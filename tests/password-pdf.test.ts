import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import createQpdf from "@neslinesli93/qpdf-wasm";
import { decryptPdf } from "../src/SabuySign.Web/Client/editor/decrypt";

async function encrypted(
  bits: number,
  user = "test-pass",
  restrictions: string[] = [],
) {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]).drawText("Original searchable content");
  const options = {
    print: () => {},
    printErr: () => {},
    locateFile: () =>
      new URL(
        "../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm",
        import.meta.url,
      ).pathname,
  };
  const q = await createQpdf(options);
  (q.FS as any).writeFile("/input.pdf", await pdf.save());
  const code = q.callMain([
    "/input.pdf",
    ...(bits === 40 ? ["--allow-weak-crypto"] : []),
    "--encrypt",
    user,
    "owner-pass",
    String(bits),
    ...restrictions,
    "--",
    "/encrypted.pdf",
  ]);
  assert.equal(code, 0);
  return q.FS.readFile("/encrypted.pdf");
}
const wasm = new URL(
  "../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm",
  import.meta.url,
).pathname;
for (const bits of [40, 128, 256])
  test(`decrypts ${bits}-bit PDF without losing editable page content`, async () => {
    const bytes = await encrypted(
      bits,
      "test-pass",
      bits === 128 ? ["--use-aes=y"] : [],
    );
    const original = bytes.slice();
    const result = await decryptPdf(bytes, "test-pass", wasm);
    const pdf = await PDFDocument.load(result);
    assert.equal(pdf.isEncrypted, false);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getPage(0).getWidth(), 595);
    assert.ok(pdf.getPage(0).node.Contents());
    assert.deepEqual(bytes, original);
  });
test("rejects wrong passwords and respects editing restrictions unless owner authenticates", async () => {
  const bytes = await encrypted(256, "test-pass", ["--modify=none"]);
  await assert.rejects(decryptPdf(bytes, "wrong", wasm), /PASSWORD/);
  await assert.rejects(decryptPdf(bytes, "test-pass", wasm), /PERMISSION/);
  assert.equal(
    (
      await PDFDocument.load(await decryptPdf(bytes, "owner-pass", wasm))
    ).getPageCount(),
    1,
  );
  const empty = await encrypted(256, "", ["--modify=none"]);
  await assert.rejects(decryptPdf(empty, "", wasm), /PERMISSION/);
});
