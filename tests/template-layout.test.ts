import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  defaults,
  layout,
  makeMeasure,
  type Definition,
} from "../src/SabuySign.Web/Client/templates/model";
const font = new Uint8Array(
  await readFile("src/SabuySign.Web/wwwroot/fonts/Sarabun-Regular.ttf"),
);
const measure = makeMeasure(font);
const def: Definition = {
  fields: [
    { id: "f", label: "ชื่อ", type: "text", required: true, defaultValue: "" },
  ],
  placements: [
    {
      id: "p",
      fieldId: "f",
      page: 0,
      x: 20,
      y: 20,
      width: 150,
      height: 60,
      size: 16,
      color: "#172433",
      align: "left",
      multiline: false,
    },
  ],
};
test("defaults are new values each time and filling does not mutate the definition", () => {
  const a = defaults(def);
  a.f = "น้ำ";
  assert.equal(defaults(def).f, "");
  assert.equal(def.fields[0].defaultValue, "");
});
test("required and overflow block export; Thai graphemes wrap without dropping text", () => {
  assert.ok(layout(def, {}, measure).errors.f);
  const text = "น้ำกุ้งปู่".repeat(15);
  assert.ok(layout(def, { f: text }, measure).errors.f);
  const multi = structuredClone(def);
  multi.placements[0].multiline = true;
  multi.placements[0].height = 500;
  const result = layout(multi, { f: text }, measure);
  assert.equal(Object.keys(result.errors).length, 0);
  assert.equal(result.items[0].text.replaceAll("\n", ""), text);
  assert.ok(result.items[0].text.includes("\n"));
});
test("one field populates all placements and smallest box controls validity", () => {
  const d = structuredClone(def);
  d.placements.push({ ...d.placements[0], id: "p2", page: 1, width: 10 });
  assert.ok(layout(d, { f: "สมชาย" }, measure).errors.f);
  d.placements[1].width = 150;
  assert.deepEqual(
    layout(d, { f: "สมชาย" }, measure).items.map((x) => x.text),
    ["สมชาย", "สมชาย"],
  );
});
test("date and number validate strictly and unsupported text is rejected before preview", () => {
  const d = structuredClone(def);
  d.fields[0].type = "date";
  assert.ok(layout(d, { f: "2026-02-31" }, measure).errors.f);
  d.fields[0].type = "number";
  assert.ok(layout(d, { f: "1e999" }, measure).errors.f);
  for (const f of ["+1", ".5", "1.", "-0.25"])
    assert.equal(Object.keys(layout(d, { f }, measure).errors).length, 0);
  d.fields[0].type = "text";
  assert.ok(layout(d, { f: "😀" }, measure).errors.f);
});

test("server-accepted field IDs never inherit object properties or bypass required validation", () => {
  for (const id of ["__proto__", "constructor", "toString"]) {
    const d = structuredClone(def);
    d.fields[0].id = id;
    d.placements[0].fieldId = id;
    assert.equal(Object.keys(layout(d, {}, measure).errors).length, 1);
    const values = Object.fromEntries([[id, "สมชาย"]]);
    assert.equal(Object.keys(layout(d, values, measure).errors).length, 0);
    d.fields[0].type = "date";
    values[id] = "2026-09-26";
    assert.equal(layout(d, values, measure).items[0].text, "26/09/2569");
  }
});
