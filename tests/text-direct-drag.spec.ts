import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test("text moves from its box and edits only after double-click", async ({
  page,
}) => {
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "direct-drag.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page
    .getByRole("button", { name: "เพิ่มข้อความ", exact: true })
    .first()
    .click();
  await page.locator("#page-surface").click({ position: { x: 100, y: 160 } });
  const box = page.locator(".text-object");
  const text = page.getByLabel("ข้อความบนเอกสาร", { exact: true });
  await text.fill("ชื่อผู้สมัคร สมชาย");
  await page.locator(".workspace-caption").click();
  await expect(page.getByLabel("ลากเพื่อย้ายข้อความ")).toHaveCount(0);
  await text.click();
  await expect(box).toHaveClass(/selected/);
  await expect(text).toHaveJSProperty("readOnly", true);
  const before = (await box.boundingBox())!;
  await page.mouse.move(before.x + 30, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + 90, before.y + before.height / 2 + 35, {
    steps: 8,
  });
  await page.mouse.up();
  const after = (await box.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(60, 0);
  expect(after.y - before.y).toBeCloseTo(35, 0);
  await expect(text).toHaveJSProperty("readOnly", true);
  await page.screenshot({ path: "artifacts/text-direct-drag.png" });
  await text.dblclick();
  await expect(text).toHaveJSProperty("readOnly", false);
  await page.screenshot({ path: "artifacts/text-double-click-edit.png" });
  await text.fill("แก้ข้อความแล้ว");
  await expect(page.getByLabel("ข้อความที่เลือก")).toHaveValue(
    "แก้ข้อความแล้ว",
  );
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(text).toHaveValue("ชื่อผู้สมัคร สมชาย");
});
