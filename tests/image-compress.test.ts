import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseOutput,
  inspectInput,
  jpegOptions,
} from "../src/SabuySign.Web/Client/image-compress/core";
test("only a strictly smaller candidate replaces the original", () => {
  const original = new Uint8Array([1, 2, 3]);
  assert.equal(chooseOutput(original, new Uint8Array(4)), original);
  assert.equal(chooseOutput(original, new Uint8Array(3)), original);
  const smaller = new Uint8Array(2);
  assert.equal(chooseOutput(original, smaller), smaller);
  assert.equal(chooseOutput(original, new Uint8Array()), original);
});
test("quality presets preserve chroma detail in the default high-quality mode", () => {
  assert.equal(jpegOptions("high").quality, 94);
  assert.equal(jpegOptions("high").chroma_subsample, 1);
  assert.equal(jpegOptions("balanced").quality, 88);
  assert.throws(() => jpegOptions("unknown"));
});
test("rejects animated PNG, truncated chunks and oversized images before decoding", () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(45),
      v = new DataView(b.buffer);
    b.set([137, 80, 78, 71, 13, 10, 26, 10]);
    v.setUint32(8, 13);
    b.set(new TextEncoder().encode("IHDR"), 12);
    v.setUint32(16, w);
    v.setUint32(20, h);
    b.set(new TextEncoder().encode("IEND"), 37);
    return b;
  };
  assert.equal(inspectInput(png(300, 200)).width, 300);
  assert.throws(() => inspectInput(png(6000, 5000)), /24/);
  const animated = png(300, 200);
  animated.set(new TextEncoder().encode("acTL"), 37);
  assert.throws(() => inspectInput(animated), /เคลื่อนไหว/);
  assert.throws(() => inspectInput(png(300, 200).slice(0, 30)));
});
