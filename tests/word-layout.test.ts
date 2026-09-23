import { test } from "node:test";
import assert from "node:assert/strict";
import {
  textLines,
  restoreThaiSpacing,
} from "../src/SabuySign.Web/Client/convert-word/layout.ts";
test("reconstructs Thai marks without added spaces and separates distant columns", () => {
  const lines = textLines([
    { text: "น", x: 10, y: 20, width: 8, size: 14 },
    { text: "้ำ", x: 17, y: 20, width: 8, size: 14 },
    { text: "3,000", x: 200, y: 20, width: 40, size: 14 },
    { text: "หัวข้อ", x: 10, y: 2, width: 50, size: 20 },
  ]);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["หัวข้อ", "น้ำ\t3,000"],
  );
});
test("preserves explicit spaces, removes XML controls, ignores nonfinite geometry", () => {
  const lines = textLines([
    { text: "Alice ", x: 0, y: 10, width: 25, size: 12 },
    { text: "& Bob\u0000", x: 28, y: 10, width: 35, size: 12 },
    { text: "bad", x: NaN, y: 10, width: 1, size: 12 },
  ]);
  assert.equal(lines[0].text, "Alice & Bob");
});
test("repairs inferred Thai spaces only when original glyph text matches exactly", () => {
  assert.equal(
    restoreThaiSpacing("น้ำ กุ้ง ปู่ ผู้รั บรอง", "น้ำ กุ้ง ปู่ ผู้รับรอง"),
    "น้ำ กุ้ง ปู่ ผู้รับรอง",
  );
  assert.equal(
    restoreThaiSpacing("Hello world ภาษา ไทย", "Helloworld ภาษา ไทย"),
    "Hello world ภาษา ไทย",
  );
  assert.equal(restoreThaiSpacing("ไทย ทดสอบ", "ไทย ต่างกัน"), "ไทย ทดสอบ");
  assert.equal(restoreThaiSpacing("ไทย ทดสอบ", "ไทย ทดสอบ"), "ไทย ทดสอบ");
});
