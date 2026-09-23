import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cropSignature,
  validateSignature,
} from "../src/SabuySign.Web/Client/signatures/data.ts";
import {
  encryptSignature,
  decryptSignature,
  newSecret,
} from "../src/SabuySign.Web/Client/signatures/crypto.ts";
const strokes = [
  [
    [100, 100],
    [120, 80],
    [180, 110],
  ],
  [
    [200, 80],
    [215, 110],
  ],
] as [number, number][][];
test("signature crops whitespace, keeps ink and rejects empty or malformed drawing", () => {
  const data = cropSignature(strokes);
  assert.equal(data.width, 131);
  assert.equal(data.height, 46);
  assert.deepEqual(data.strokes[0][0], [8, 28]);
  assert.throws(() => cropSignature([]));
  assert.throws(() => validateSignature({ ...data, strokes: [[[NaN, 0]]] }));
  assert.throws(() => validateSignature({ ...data, width: Infinity }));
  assert.throws(() => validateSignature({ ...data, brush: "unknown" }));
});
test("encrypted signature roundtrip is session-bound, authenticated and uses fresh IV", async () => {
  const data = cropSignature(strokes, "pen"),
    key = newSecret();
  const one = await encryptSignature(data, key, "session-a");
  const two = await encryptSignature(data, key, "session-a");
  assert.notDeepEqual(one, two);
  assert.deepEqual(await decryptSignature(one, key, "session-a"), data);
  await assert.rejects(decryptSignature(one, key, "session-b"));
  one[20] ^= 1;
  await assert.rejects(decryptSignature(one, key, "session-a"));
});

test("undo while a pointer is drawing cancels that stroke safely", async () => {
  const { SignaturePad } =
    await import("../src/SabuySign.Web/Client/signatures/pad.ts");
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as any;
  const canvas = new EventTarget() as any;
  let fills = 0;
  const context = new Proxy(
    {},
    {
      get: (_, key) => () => {
        if (key === "fill") fills++;
      },
    },
  );
  canvas.getContext = () => context;
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 640,
    height: 240,
  });
  canvas.setPointerCapture = () => {};
  const pad = new SignaturePad(canvas, () => {});
  const pointer = (type: string, x: number) =>
    canvas.dispatchEvent(
      Object.assign(new Event(type), { pointerId: 1, clientX: x, clientY: 60 }),
    );
  try {
    pointer("pointerdown", 20);
    pointer("pointermove", 40);
    pad.undo();
    pointer("pointermove", 80);
    pointer("pointerup", 80);
    assert.equal(pad.empty, true);
    pointer("pointerdown", 20);
    pointer("pointermove", 50);
    pointer("pointerup", 50);
    assert.equal(pad.empty, false);
    assert.equal(pad.save().strokes.length, 1);
    assert.ok(
      fills > 0,
      "live mouse pad must paint a pen outline, not a uniform-width line",
    );
    assert.equal((pad.save() as any).brush, "pen");
    pad.clear();
    pointer("pointerdown", 20);
    canvas.dispatchEvent(
      Object.assign(new Event("pointermove"), {
        pointerId: 1,
        clientX: 50,
        clientY: 60,
        getCoalescedEvents: () => [
          { clientX: 30, clientY: 50 },
          { clientX: 40, clientY: 45 },
        ],
      }),
    );
    pointer("pointerup", 70);
    assert.deepEqual(pad.save().strokes[0], [
      [8, 23],
      [18, 13],
      [28, 8],
      [38, 23],
      [58, 23],
    ]);
  } finally {
    pad.dispose();
    globalThis.ResizeObserver = original;
  }
});

test("signature preview rounds corners with curves and retains endpoints", async () => {
  const { signatureSvg } =
    await import("../src/SabuySign.Web/Client/signatures/data.ts");
  const svg = signatureSvg({
    width: 120,
    height: 100,
    strokes: [
      [
        [10, 80],
        [60, 10],
        [110, 80],
      ],
    ],
  });
  assert.match(svg, /M10 80/);
  assert.match(svg, /C/);
  assert.match(svg, /110 80/);
});

test("mouse pen weight varies with sample velocity and stays within crop padding", async () => {
  const { penOutline, penPath } =
    await import("../src/SabuySign.Web/Client/signatures/pen.ts");
  const weight = (step: number) => {
    const points: [number, number][] = Array.from(
      { length: Math.floor(240 / step) + 1 },
      (_, i) => [i * step, 50],
    );
    const outline = penOutline(points);
    assert.ok(
      outline.every(
        ([x, y]) =>
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          x >= -8 &&
          x <= 248 &&
          y >= 42 &&
          y <= 58,
      ),
    );
    const middle = outline.filter(([x]) => x > 100 && x < 200);
    return (
      Math.max(...middle.map((p) => p[1])) -
      Math.min(...middle.map((p) => p[1]))
    );
  };
  assert.ok(
    weight(1) > weight(8) * 1.5,
    "slow mouse stroke should have more weight than a quick sweep",
  );
  const path = penPath([
    [10, 30],
    [40, 10],
    [70, 30],
  ]);
  assert.deepEqual(
    path[0].point,
    path.at(-1)!.point,
    "filled pen outline must close without a seam",
  );
});
