import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
async function open(page: import("@playwright/test").Page) {
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "mark-form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator("#page-canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "เครื่องหมาย", exact: true }),
  ).toBeEnabled();
}
test("marks place continuously, edit, duplicate, undo, navigate and export locally", async ({
  page,
}) => {
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") uploads.push(r.url());
  });
  await open(page);
  await page.getByRole("button", { name: "เครื่องหมาย", exact: true }).click();
  await page
    .locator("#mark-picker")
    .getByRole("button", { name: "ติ๊กถูก", exact: true })
    .click();
  await page.locator("#page-surface").click({ position: { x: 110, y: 180 } });
  await page.locator("#page-surface").click({ position: { x: 180, y: 240 } });
  await expect(page.locator(".mark-object")).toHaveCount(2);
  await page.locator(".mark-visual").first().click();
  const selectedBefore = await page
    .locator(".mark-object.selected")
    .boundingBox();
  const move = await page
    .getByRole("button", { name: "ลากเพื่อย้ายเครื่องหมาย", exact: true })
    .boundingBox();
  await page.mouse.move(move!.x + 10, move!.y + 10);
  await page.mouse.down();
  await page.mouse.move(move!.x + 40, move!.y + 25);
  await page.mouse.up();
  const selectedAfter = await page
    .locator(".mark-object.selected")
    .boundingBox();
  expect(selectedAfter!.x - selectedBefore!.x).toBeCloseTo(30, 0);
  expect(selectedAfter!.y - selectedBefore!.y).toBeCloseTo(15, 0);

  await page.getByLabel("ขนาดเครื่องหมาย", { exact: true }).fill("32");
  await page.getByLabel("ขนาดเครื่องหมาย", { exact: true }).blur();
  const resized = await page.locator(".mark-object.selected").boundingBox();
  expect(resized!.x + resized!.width / 2).toBeCloseTo(
    selectedAfter!.x + selectedAfter!.width / 2,
    0,
  );
  expect(resized!.y + resized!.height / 2).toBeCloseTo(
    selectedAfter!.y + selectedAfter!.height / 2,
    0,
  );

  await page.getByRole("button", { name: "สีน้ำเงิน", exact: true }).click();
  await page.getByRole("button", { name: "กากบาท", exact: true }).click();
  await expect(page.locator(".mark-object.selected .mark-visual")).toHaveCSS(
    "color",
    "rgb(23, 107, 168)",
  );
  await page
    .getByRole("button", { name: "ทำสำเนาเครื่องหมาย", exact: true })
    .click();
  await expect(page.locator(".mark-object")).toHaveCount(3);
  await page
    .locator(".mark-object.selected")
    .getByRole("button", { name: "ลบเครื่องหมาย", exact: true })
    .click();
  await expect(page.locator(".mark-object")).toHaveCount(2);
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(page.locator(".mark-object")).toHaveCount(3);
  await page.getByRole("button", { name: "หน้า 2", exact: true }).click();
  await expect(page.locator(".mark-object")).toHaveCount(0);
  await page.getByRole("button", { name: "หน้า 1", exact: true }).click();
  await expect(page.locator(".mark-object")).toHaveCount(3);
  await page
    .getByRole("button", { name: "ดูตัวอย่าง PDF", exact: true })
    .click();
  await expect(page.locator("#preview-dialog")).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลดไฟล์นี้", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("mark-form-filled.pdf");
  expect(uploads).toEqual([]);
});
test("mobile single placement uses bottom controls without viewport overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "เครื่องหมาย", exact: true }).click();
  await page
    .locator("#mark-picker")
    .getByRole("button", { name: "วงกลม", exact: true })
    .click();
  await page.locator("#page-surface").click({ position: { x: 30, y: 100 } });
  await expect(page.locator(".mark-object.selected")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "เสร็จ", exact: true }),
  ).toBeVisible();
  await page.locator("#page-surface").click({ position: { x: 90, y: 160 } });
  await expect(page.locator(".mark-object")).toHaveCount(1);
  await page.locator(".mark-visual").first().click();
  await page.getByRole("button", { name: "+ วางอีก", exact: true }).click();
  await page.locator("#page-surface").click({ position: { x: 100, y: 160 } });
  await expect(page.locator(".mark-object")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const actions = await page
    .locator(".mark-object.selected .object-actions")
    .boundingBox();
  expect(actions!.x).toBeGreaterThanOrEqual(0);
  expect(actions!.x + actions!.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "เสร็จ", exact: true }).click();
  await expect(page.locator(".mark-object.selected")).toHaveCount(0);
  await page.getByLabel("หน้าเอกสาร", { exact: true }).selectOption("2");
  await expect(page.locator(".mark-object")).toHaveCount(0);
});

test("mobile provides touch undo and editing the selected mark type", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "mobile.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator("#page-canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ย้อนกลับ", exact: true }),
  ).toBeVisible();
  await page.locator(".mark-picker-wrap>.tool").click();
  await page
    .locator("#mark-picker")
    .getByRole("button", { name: "ติ๊กถูก", exact: true })
    .click();
  await page.locator("#page-surface").click({ position: { x: 80, y: 130 } });
  await page.locator(".mark-picker-wrap>.tool").click();
  await page
    .locator("#mark-picker")
    .getByRole("button", { name: "กากบาท", exact: true })
    .click();
  await expect(page.locator(".mark-object.selected polyline")).toHaveCount(2);
  await expect(page.locator(".mark-object")).toHaveCount(1);
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(page.locator(".mark-object polyline")).toHaveCount(1);
});

test("shape picker keeps an existing selected mark", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "shape.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator("#page-canvas")).toBeVisible();
  await page.locator(".mark-picker-wrap>.tool").click();
  await page
    .locator("#mark-picker")
    .getByRole("button", { name: "ติ๊กถูก", exact: true })
    .click();
  await page.locator("#page-surface").click({ position: { x: 80, y: 130 } });
  await expect(page.locator(".mark-object.selected")).toHaveCount(1);
  await page.locator(".mark-picker-wrap>.tool").click();
  await expect(page.locator(".mark-object.selected")).toHaveCount(1);
});
