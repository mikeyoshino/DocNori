import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seal,
  unseal,
  validatePlacements,
} from "../src/SabuySign.Web/Client/signing-sessions/crypto";
import { newSecret } from "../src/SabuySign.Web/Client/signatures/crypto";
test("encrypted session payload authenticates key and context", async () => {
  const key = newSecret(),
    bytes = new TextEncoder().encode("private Thai ไทย");
  const sealed = await seal(bytes, key, "session/document");
  assert.deepEqual(await unseal(sealed, key, "session/document"), bytes);
  await assert.rejects(() => unseal(sealed, newSecret(), "session/document"));
  await assert.rejects(() => unseal(sealed, key, "other/document"));
});
test("rejects invalid page and injected text in confirmed signature batches", () => {
  assert.throws(() => validatePlacements([{ page: -1 }], 2));
  assert.throws(() => validatePlacements([{ page: 0, text: "<script>" }], 2));
  assert.throws(() => validatePlacements([], 2));
});
test("accepted placements discard extra properties and reject oversized batches", () => {
  const item = {
    id: "draft",
    page: 0,
    x: 10,
    y: 20,
    width: 60,
    height: 20,
    text: "",
    size: 2.4,
    color: "#172433",
    align: "left",
    signature: {
      width: 60,
      height: 20,
      strokes: [
        [
          [1, 1],
          [20, 15],
          [50, 10],
        ],
      ],
    },
    untrusted: "discard",
  };
  const clean = validatePlacements([item], 2);
  assert.equal(clean.length, 1);
  assert.equal("untrusted" in clean[0], false);
  assert.throws(() =>
    validatePlacements(
      Array.from({ length: 51 }, () => item),
      2,
    ),
  );
  assert.throws(() => validatePlacements([{ ...item, x: Infinity }], 2));
});
