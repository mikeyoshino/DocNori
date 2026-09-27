import { test } from "node:test";
import assert from "node:assert/strict";
import { EditHistory } from "../src/SabuySign.Web/Client/templates/history";
test("undo restores a deleted shared field and placements without aliasing live state", () => {
  const initial = {
    fields: [{ id: "a", defaultValue: "บริษัท" }],
    placements: [
      { fieldId: "a", page: 0 },
      { fieldId: "a", page: 2 },
    ],
  };
  const history = new EditHistory(initial);
  initial.fields = [];
  initial.placements = [];
  history.record(initial);
  const restored = history.undo()!;
  assert.equal(restored.fields[0].defaultValue, "บริษัท");
  assert.equal(restored.placements.length, 2);
  restored.fields[0].defaultValue = "changed";
  assert.deepEqual(history.redo(), { fields: [], placements: [] });
  assert.equal(history.undo()!.fields[0].defaultValue, "บริษัท");
});
test("a new edit clears redo and identical updates do not create undo steps", () => {
  const h = new EditHistory({ x: 0 });
  h.record({ x: 0 });
  assert.equal(h.canUndo, false);
  h.record({ x: 20 });
  h.record({ x: 40 });
  assert.deepEqual(h.undo(), { x: 20 });
  h.record({ x: 21 });
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.undo(), { x: 20 });
});
test("history keeps its memory bound and stops at the oldest retained change", () => {
  const h = new EditHistory({ x: 0 }, 3);
  for (let x = 1; x <= 5; x++) h.record({ x });
  assert.deepEqual(h.undo(), { x: 4 });
  assert.deepEqual(h.undo(), { x: 3 });
  assert.equal(h.undo(), undefined);
});
