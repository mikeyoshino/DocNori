import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitPage,
  validateBatch,
  imageDimensions,
  uniqueJpgName,
} from "../src/SabuySign.Web/Client/image-tools/core";
test("page fitting centers portrait and landscape images without cropping", () => {
  for (const [w, h] of [
    [1000, 2000],
    [2000, 1000],
  ]) {
    const fit = fitPage(w, h, "a4", "auto", 18);
    assert.ok(fit.x >= 18 && fit.y >= 18);
    assert.ok(fit.width + fit.x <= fit.pageWidth - 18 + 0.01);
    assert.ok(fit.height + fit.y <= fit.pageHeight - 18 + 0.01);
    assert.equal(fit.pageWidth > fit.pageHeight, w > h);
  }
  assert.deepEqual(fitPage(800, 400, "image", "auto", 0), {
    pageWidth: 600,
    pageHeight: 300,
    x: 0,
    y: 0,
    width: 600,
    height: 300,
  });
});
test("batch limits reject excess files, bytes and wrong formats", () => {
  assert.throws(
    () => validateBatch([{ name: "x.gif", size: 10 }], 0, 0, "pdf"),
    /JPG/,
  );
  assert.throws(
    () =>
      validateBatch([{ name: "x.heic", size: 21 * 1024 * 1024 }], 0, 0, "heic"),
    /20 MB/,
  );
  assert.throws(
    () => validateBatch([{ name: "x.jpg", size: 10 }], 20, 0, "pdf"),
    /20 ไฟล์/,
  );
  assert.throws(
    () =>
      validateBatch([{ name: "x.png", size: 10 }], 0, 100 * 1024 * 1024, "pdf"),
    /100 MB/,
  );
});
test("unique JPG names avoid duplicates and unsafe path characters", () => {
  const used = new Set<string>();
  assert.equal(uniqueJpgName("ภาพ.HEIC", used), "ภาพ.jpg");
  assert.equal(uniqueJpgName("ภาพ.heic", used), "ภาพ-2.jpg");
  assert.equal(uniqueJpgName("../x.heic", used), ".._x.jpg");
});
test("header sniffing rejects fake images before decoding", () => {
  assert.throws(() => imageDimensions(new Uint8Array([1, 2, 3])), /รูปภาพ/);
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.set([73, 72, 68, 82], 12);
  const v = new DataView(png.buffer);
  v.setUint32(16, 200);
  v.setUint32(20, 300);
  assert.equal(imageDimensions(png).width, 200);
  v.setUint32(16, 100000);
  assert.throws(() => imageDimensions(png), /ใหญ่/);
});
