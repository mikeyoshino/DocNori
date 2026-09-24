import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDate,
  localDate,
  type DateStamp,
} from "../src/SabuySign.Web/Client/editor/dates.ts";
import { Session } from "../src/SabuySign.Web/Client/editor/session.ts";
const stamp: DateStamp = {
  value: "2026-09-24",
  calendar: "buddhist",
  format: "numeric",
};
test("date formats distinguish Gregorian input and Buddhist display", () => {
  assert.equal(formatDate(stamp), "24/09/2569");
  assert.equal(formatDate({ ...stamp, calendar: "gregorian" }), "24/09/2026");
  assert.equal(formatDate({ ...stamp, format: "short" }), "24 ก.ย. 2569");
  assert.equal(formatDate({ ...stamp, format: "long" }), "24 กันยายน 2569");
  assert.equal(localDate(new Date(2026, 0, 2, 0, 5)), "2026-01-02");
  assert.equal(formatDate({ ...stamp, value: "2024-02-29" }), "29/02/2567");
  for (const value of [
    "",
    "2026-02-29",
    "2026-13-01",
    "2026-04-31",
    "0000-01-01",
  ])
    assert.throws(() => formatDate({ ...stamp, value }));
});
test("dates retain metadata, text sizing and a single undoable placement", () => {
  const s = new Session();
  s.add(0, 10, 20);
  s.update(s.selected!, { size: 24 });
  s.add(0, 20, 30, stamp);
  const id = s.selected!;
  assert.equal(s.items[1].size, 24);
  assert.equal(s.items[1].text, "24/09/2569");
  s.update(id, { date: { ...stamp, calendar: "gregorian" } });
  assert.equal(s.items[1].text, "24/09/2026");
  s.undo();
  assert.equal(s.items[1].text, "24/09/2569");
  s.undo();
  assert.equal(s.items.length, 1);
  s.redo();
  assert.deepEqual(s.items[1].date, stamp);
});
