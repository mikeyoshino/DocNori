import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import { mergePdfs } from "../src/SabuySign.Web/Client/merge/pdf";

test("merge preserves source order, page dimensions, rotation and field appearance", async () => {
  const a = await PDFDocument.create();
  const page = a.addPage([300, 500]);
  page.setRotation(degrees(90));
  const field = a.getForm().createTextField("name");
  field.setText("Alice");
  field.addToPage(page);
  const b = await PDFDocument.create();
  b.addPage([600, 800]);
  b.addPage([200, 400]);
  const ab = await a.save(),
    bb = await b.save();
  const output = await PDFDocument.load(await mergePdfs([bb, ab]));
  assert.deepEqual(
    output.getPages().map((p) => p.getWidth()),
    [600, 200, 300],
  );
  assert.equal(output.getPage(2).getRotation().angle, 90);
  assert.equal(output.getForm().getFields().length, 0);
  assert.ok(output.getPage(2).node.Contents());
  assert.equal((await PDFDocument.load(ab)).getForm().getFields().length, 1);
});
test("merge rejects missing, malformed and excessive pages", async () => {
  await assert.rejects(mergePdfs([]));
  await assert.rejects(mergePdfs([new Uint8Array([1]), new Uint8Array([2])]));
  const doc = await PDFDocument.create();
  for (let i = 0; i < 51; i++) doc.addPage();
  const bytes = await doc.save();
  await assert.rejects(mergePdfs([bytes, bytes]), /100/);
});
