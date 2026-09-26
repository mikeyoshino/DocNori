import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import {
  PageHistory,
  movePage,
  type OrganizePage,
} from "../src/SabuySign.Web/Client/organize/state";
import { organizePdf } from "../src/SabuySign.Web/Client/organize/pdf";
const p = (id: string, index = 0): OrganizePage => ({
  id,
  sourceId: "a",
  pageIndex: index,
  rotation: 0,
});
test("page moves are reversible and a new edit clears redo without mutating earlier pages", () => {
  const original = [p("1"), p("2", 1), p("3", 2)];
  const h = new PageHistory();
  h.apply(original);
  h.apply(movePage(h.pages, 0, 2));
  assert.deepEqual(
    h.pages.map((p) => p.id),
    ["2", "3", "1"],
  );
  h.undo();
  assert.deepEqual(
    h.pages.map((p) => p.id),
    ["1", "2", "3"],
  );
  h.redo();
  assert.equal(h.pages[0].id, "2");
  h.undo();
  h.apply(h.pages.slice(1));
  assert.equal(h.canRedo, false);
  assert.equal(original.length, 3);
  assert.throws(
    () => h.apply(Array.from({ length: 101 }, (_, i) => p(String(i)))),
    /100/,
  );
});
test("organizing preserves content, source rotation, dimensions and field appearance while reordering, duplicating and inserting blank pages", async () => {
  const a = await PDFDocument.create();
  const first = a.addPage([300, 500]);
  first.setRotation(degrees(90));
  const field = a.getForm().createTextField("name");
  field.setText("Alice");
  field.addToPage(first);
  a.addPage([400, 600]);
  const b = await PDFDocument.create();
  b.addPage([200, 700]);
  const ab = await a.save(),
    bb = await b.save();
  const result = await PDFDocument.load(
    await organizePdf(
      [
        { id: "a", bytes: ab },
        { id: "b", bytes: bb },
      ],
      [
        p("second", 1),
        { ...p("other"), sourceId: "b", rotation: 90 },
        { ...p("copy"), rotation: 270 },
        p("original"),
        { id: "blank", sourceId: null, pageIndex: 0, rotation: 90 },
      ],
    ),
  );
  assert.deepEqual(
    result.getPages().map((p) => Math.round(p.getWidth())),
    [400, 200, 300, 300, 595],
  );
  assert.deepEqual(
    result.getPages().map((p) => p.getRotation().angle),
    [0, 90, 0, 90, 90],
  );
  assert.ok(result.getPage(2).node.Contents());
  assert.equal(result.getForm().getFields().length, 0);
  assert.equal((await PDFDocument.load(ab)).getForm().getFields().length, 1);
});
test("export rejects an empty output, bad source references, invalid rotations and too many pages", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const sources = [{ id: "a", bytes: await doc.save() }];
  await assert.rejects(organizePdf(sources, []));
  await assert.rejects(organizePdf(sources, [p("missing", 2)]));
  await assert.rejects(
    organizePdf(sources, [{ ...p("bad"), sourceId: "missing" }]),
  );
  await assert.rejects(organizePdf(sources, [{ ...p("bad"), rotation: 45 }]));
  await assert.rejects(
    organizePdf(
      sources,
      Array.from({ length: 101 }, (_, i) => p(String(i))),
    ),
    /100/,
  );
});

test("shared fonts stay shared when organizing many pages", async () => {
  const { readFile } = await import("node:fs/promises");
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile("src/SabuySign.Web/wwwroot/fonts/Sarabun-Regular.ttf"),
  );
  for (let i = 0; i < 30; i++)
    pdf.addPage().drawText("ทดสอบภาษาไทย", { font, size: 16, x: 20, y: 50 });
  const bytes = await pdf.save();
  const output = await organizePdf(
    [{ id: "a", bytes }],
    Array.from({ length: 30 }, (_, i) => p(String(i), 29 - i)),
  );
  assert.ok(
    output.length < bytes.length * 2,
    `shared font should not be embedded on every page: ${bytes.length} -> ${output.length}`,
  );
});
