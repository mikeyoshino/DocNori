import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/SabuySign.Web/Client/editor/session.ts";

test("undo restores text and coordinates; branching invalidates redo and export revision", () => {
  const s = new Session();
  s.add(0, 30, 40);
  const id = s.selected!;
  s.update(id, { text: "น้ำ กุ้ง", x: 90 });
  const revision = s.revision;
  s.undo();
  assert.equal(s.items[0].text, "ข้อความ");
  assert.equal(s.items[0].x, 30);
  s.redo();
  assert.equal(s.items[0].text, "น้ำ กุ้ง");
  assert.ok(s.revision > revision);
  s.undo();
  s.update(id, { text: "ผู้รับรอง" });
  assert.equal(s.canRedo, false);
});
test("deleting and undoing restores the object; snapshots cannot mutate history", () => {
  const s = new Session();
  s.add(0, 20, 20);
  const id = s.selected!;
  s.remove(id);
  assert.equal(s.items.length, 0);
  s.undo();
  assert.equal(s.items[0].id, id);
  const snapshot = s.items;
  snapshot[0].text = "changed";
  assert.equal(s.items[0].text, "ข้อความ");
});

test("a saved signature can be placed twice and undone independently", () => {
  const s = new Session();
  const ink = {
    width: 100,
    height: 50,
    strokes: [
      [
        [8, 8],
        [90, 40],
      ],
    ] as [number, number][][],
  };
  s.addSignature(0, 20, 30, ink);
  s.addSignature(1, 40, 50, ink);
  assert.equal(s.items.length, 2);
  assert.notEqual(s.items[0].id, s.items[1].id);
  s.undo();
  assert.equal(s.items.length, 1);
  s.redo();
  assert.deepEqual(s.items[1].signature, ink);
});

test("new text remembers last text size, independent of marks and new sessions", () => {
  const session = new Session();
  session.add(0, 10, 20);
  session.update(session.selected!, { size: 28 });
  session.addMark(0, 50, 50, "check", 40, "#172c40");
  session.add(0, 100, 100);
  assert.equal(session.items.at(-1)!.size, 28);
  const fresh = new Session();
  fresh.add(0, 0, 0);
  assert.equal(fresh.items[0].size, 16);
});
