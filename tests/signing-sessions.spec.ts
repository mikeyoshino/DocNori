import { chooseDropdown } from "./helpers/dropdown";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { readFile } from "node:fs/promises";
async function draw(page: Page) {
  await page.locator("#signing-add").click();
  await page.locator("#sign-desktop").click();
  const box = (await page.locator("#desktop-pad").boundingBox())!;
  await page.mouse.move(box.x + 25, box.y + 65);
  await page.mouse.down();
  for (const [x, y] of [
    [65, 25],
    [110, 75],
    [145, 40],
    [195, 90],
  ])
    await page.mouse.move(box.x + x, box.y + y, { steps: 8 });
  await page.mouse.up();
  await page.locator("#desktop-save").click();
}
async function place(page: Page, x: number, y: number) {
  await page.getByRole("button", { name: "วางลายเซ็น 1", exact: true }).click();
  await page.locator("#page-surface").click({ position: { x, y } });
}
for (const mobile of [false, true]) {
  test(`shared session ${mobile ? "mobile" : "desktop"}: two people, all pages, real-time, locked final PDF and deletion`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    pdf.addPage([595, 842]);
    await page.goto("/tools/fill-sign");
    await expect(
      page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
    ).toBeEnabled();
    await page.locator("#pdf-file").setInputFiles({
      name: "shared-test.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
    await page
      .locator(".signature-library-panel")
      .getByRole("button", { name: "เซ็นเอกสาร", exact: true })
      .click();
    await page.locator("#sign-with-others").click();
    await page.locator("#signing-create-confirm").click();
    await expect(page.locator("#signing-share-dialog")).toBeVisible();
    const link = await page.locator("#signing-share-link").inputValue();
    expect(link).toContain("/sign-together#v1.");
    await page
      .getByRole("button", { name: "ปิดหน้าแชร์ลิงก์", exact: true })
      .click();
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
    });
    const guest = await context.newPage();
    guest.on("pageerror", (e) => errors.push(e.message));
    await guest.goto(link);
    await expect(guest.locator("#page-canvas")).toBeVisible();
    await expect(guest.locator("#signing-state")).toHaveText("เปิดรับลายเซ็น");
    await expect(guest.locator("#signing-finish")).toBeHidden();
    await draw(guest);
    await place(guest, 120, 180);
    if (mobile) await chooseDropdown(guest, "หน้าเอกสาร", "2");
    else await guest.locator("#thumbnails button").nth(1).click();
    await place(guest, 150, 250);
    await expect(guest.locator("#signing-submit")).toHaveText(
      "ยืนยันลายเซ็น · 2 จุด",
    );
    await expect(page.locator(".confirmed-signature")).toHaveCount(0);
    guest.on("dialog", (d) => d.accept());
    page.on("dialog", (d) => d.accept());
    if (!mobile)
      await guest.route(
        "**/api/signing/*/batches/*",
        async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          await route.fetch();
          await route.abort("failed");
        },
        { times: 1 },
      );
    await guest.locator("#signing-submit").click();
    await guest.locator("#signing-confirm-accept").click();
    if (!mobile) {
      await expect(guest.locator("#signing-submit")).toHaveText(
        "ลองยืนยันอีกครั้ง",
      );
      await guest.locator("#signing-submit").click();
    }
    await expect(page.locator(".confirmed-signature")).toHaveCount(1, {
      timeout: 15000,
    });
    await expect(page.locator("#signing-live")).toContainText(
      "ยืนยันแล้ว 2 จุด",
    );
    await expect(guest.locator(".signature-object")).toHaveCount(0);
    await draw(page);
    await place(page, 160, 330);
    await page.locator("#signing-submit").click();
    await page.locator("#signing-confirm-accept").click();
    await expect(guest.locator("#signing-live")).toContainText(
      "ยืนยันแล้ว 3 จุด",
      { timeout: 15000 },
    );
    await page.locator("#signing-finish").click();
    await page.locator("#signing-confirm-accept").click();
    await expect(guest.locator("#signing-state")).toHaveText("พร้อมดาวน์โหลด", {
      timeout: 15000,
    });
    await guest.reload();
    await expect(guest.locator("#signing-state")).toHaveText("พร้อมดาวน์โหลด");
    await guest
      .getByRole("button", { name: "ดาวน์โหลด PDF", exact: true })
      .click();
    await expect(guest.locator("#preview-dialog")).toBeVisible();
    const download = guest.waitForEvent("download");
    await guest
      .getByRole("button", { name: "ดาวน์โหลดไฟล์นี้", exact: true })
      .click();
    const file = await download;
    const result = await PDFDocument.load(await readFile((await file.path())!));
    expect(result.getPageCount()).toBe(2);
    const ink = result.context
      .enumerateIndirectObjects()
      .filter(([, v]) => v instanceof PDFRawStream)
      .map(([, v]) => {
        try {
          return Buffer.from(
            decodePDFRawStream(v as PDFRawStream).decode(),
          ).toString();
        } catch {
          return "";
        }
      })
      .join("\n");
    expect(ink.match(/\nf\n/g)?.length).toBe(3);
    expect((await readFile((await file.path())!)).length).toBeGreaterThan(1500);
    await guest
      .getByRole("button", { name: "ปิดตัวอย่าง", exact: true })
      .click();
    await guest.screenshot({
      path: `artifacts/shared-signing-${mobile ? "mobile" : "desktop"}-final.png`,
      fullPage: true,
    });
    await page.locator("#signing-delete").click();
    await page.locator("#signing-confirm-accept").click();
    await expect(guest.locator("#signing-state")).toHaveText(
      "session ปิดแล้ว",
      {
        timeout: 15000,
      },
    );
    expect(errors).toEqual([]);
    await context.close();
  });
}
