import { chooseDropdown } from "./helpers/dropdown";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
for (const mobile of [false, true]) {
  test(`date placement, calendar edit, history and preview ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tools/fill-sign");
    await expect(
      page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
    ).toBeEnabled();
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    await page.locator("#pdf-file").setInputFiles({
      name: "dates.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
    await page
      .getByRole("button", { name: "เพิ่มวันที่", exact: true })
      .click();
    await page.locator("#stamp-date").fill("2026-09-24");
    await page.locator("#stamp-date").blur();
    await expect(page.getByLabel("ตัวอย่างวันที่", { exact: true })).toHaveText(
      "24/09/2569",
    );
    await chooseDropdown(page, "รูปแบบวันที่", "long");
    await page.getByLabel("ขนาดตัวอักษรวันที่", { exact: true }).fill("24");
    await page.getByLabel("ขนาดตัวอักษรวันที่", { exact: true }).blur();
    await page.screenshot({
      path: `artifacts/date-${mobile ? "mobile" : "desktop"}-place.png`,
    });
    await page.locator("#page-surface").click({ position: { x: 65, y: 90 } });
    await expect(
      page.getByLabel("วันที่บนเอกสาร", { exact: true }),
    ).toHaveValue("24 กันยายน 2569");
    await expect(
      page.getByLabel("ขนาดตัวอักษรวันที่", { exact: true }),
    ).toHaveValue("24");
    await expect(page.getByLabel("ลากเพื่อย้ายข้อความ")).toHaveCount(0);
    const beforeMove = (await page.locator(".text-object").boundingBox())!;
    await page.mouse.move(
      beforeMove.x + 18,
      beforeMove.y + beforeMove.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      beforeMove.x + 42,
      beforeMove.y + beforeMove.height / 2 + 16,
      { steps: 8 },
    );
    await page.mouse.up();
    const afterMove = (await page.locator(".text-object").boundingBox())!;
    expect(afterMove.x - beforeMove.x).toBeCloseTo(24, 0);
    expect(afterMove.y - beforeMove.y).toBeCloseTo(16, 0);
    await page.getByRole("button", { name: "ค.ศ.", exact: true }).click();
    await expect(
      page.getByLabel("วันที่บนเอกสาร", { exact: true }),
    ).toHaveValue("24 กันยายน 2026");
    await page.screenshot({
      path: `artifacts/date-${mobile ? "mobile" : "desktop"}-edit.png`,
    });
    await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
    await expect(
      page.getByLabel("วันที่บนเอกสาร", { exact: true }),
    ).toHaveValue("24 กันยายน 2569");
    await page.getByLabel("วันที่บนเอกสาร", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "พ.ศ.", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "ลบวันที่", exact: true }).click();
    await expect(
      page.getByLabel("วันที่บนเอกสาร", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
    await expect(
      page.getByLabel("วันที่บนเอกสาร", { exact: true }),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "ดาวน์โหลด PDF", exact: true })
      .click();
    await expect(page.locator("#preview-canvas")).toBeVisible();
    await page.locator("#preview-canvas").screenshot({
      path: `artifacts/date-${mobile ? "mobile" : "desktop"}-export.png`,
    });
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "ดาวน์โหลดไฟล์นี้", exact: true })
      .click();
    expect((await downloading).suggestedFilename()).toBe("dates-filled.pdf");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("shared dropdown has consistent visual menu, keyboard selection, and outside dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "dropdown.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole("button", { name: "เพิ่มวันที่", exact: true }).click();
  const format = page.getByRole("button", {
    name: "รูปแบบวันที่",
    exact: true,
  });
  await format.click();
  const list = page.getByRole("listbox", { name: "รูปแบบวันที่" });
  await expect(list).toBeVisible();
  await page.screenshot({ path: "artifacts/dropdown-mobile-open.png" });
  await expect(list.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("ตัวอย่างวันที่", { exact: true }),
  ).toContainText("2569");
  await expect(format).toContainText("เดือนเต็ม");
  await format.click();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await format.click();
  await page
    .locator(".workspace-caption")
    .click({ position: { x: 240, y: 15 } });
  await expect(list).toBeHidden();
  const pages = page.getByRole("button", { name: "หน้าเอกสาร", exact: true });
  await pages.click();
  await page.getByRole("option", { name: "2 / 2", exact: true }).click();
  await expect(pages).toContainText("2 / 2");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
