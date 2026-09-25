import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
async function open(page: Page) {
  await page.goto("/tools/compress");
  await expect(page.locator("[data-choose]")).toBeEnabled({ timeout: 30000 });
}
async function fixture(page: Page) {
  const jpeg = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 2200;
    c.height = 1600;
    const ctx = c.getContext("2d")!,
      im = ctx.createImageData(c.width, c.height);
    let seed = 42;
    for (let i = 0; i < im.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = seed >>> 24;
      im.data[i] = v;
      im.data[i + 1] = (v + 80) % 256;
      im.data[i + 2] = 180;
      im.data[i + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL("image/jpeg", 0.98).split(",")[1];
  });
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile("src/SabuySign.Web/wwwroot/fonts/Sarabun-Regular.ttf"),
    { subset: true },
  );
  const page1 = doc.addPage([595, 842]);
  page1.drawText("เอกสารทดสอบภาษาไทย", { font, size: 22, x: 30, y: 785 });
  const image = await doc.embedJpg(Buffer.from(jpeg, "base64"));
  page1.drawImage(image, { x: 30, y: 200, width: 530, height: 380 });
  const page2 = doc.addPage([400, 600]);
  page2.setRotation(degrees(90));
  page2.drawText("หน้าที่สอง", { font, size: 22, x: 30, y: 500 });
  return Buffer.from(await doc.save());
}
test("compress landing renders without JavaScript and has SEO metadata", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/tools/compress");
  await expect(
    page.getByRole("heading", { name: "ลดขนาด PDF", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-intro]")).toContainText("50 MB");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/tools\/compress$/,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index,follow",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /ไม่ถูกส่งขึ้นเซิร์ฟเวอร์/,
  );
  expect(await page.locator('script[src*="adsbygoogle"]').count()).toBe(0);
  await context.close();
});
test("local compression reduces images, preserves Thai text and pages, and previews both files", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [],
    uploads: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
  });
  await open(page);
  await page.screenshot({ path: "artifacts/compress-landing-desktop.png" });
  const source = await fixture(page);
  await page.locator("[data-file]").setInputFiles({
    name: "เอกสาร.pdf",
    mimeType: "application/pdf",
    buffer: source,
  });
  await expect(page.locator("[data-preview] canvas")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator("[data-info]")).toContainText("2 หน้า");
  await page.locator("[data-run]").click();
  await expect(page.locator("[data-download]")).toBeVisible({ timeout: 60000 });
  await expect(page.locator("[data-saved]")).toContainText("เล็กลง");
  await expect(page.locator("[data-preview-status]")).toBeEmpty();
  await page.screenshot({ path: "artifacts/compress-result-desktop.png" });
  const download = page.waitForEvent("download");
  await page.locator("[data-download]").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("เอกสาร-compressed.pdf");
  const output = await readFile((await file.path())!);
  expect(output.length).toBeLessThan(source.length * 0.75);
  const task = getDocument({
    data: new Uint8Array(output),
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  expect(pdf.numPages).toBe(2);
  const content = await (await pdf.getPage(1)).getTextContent();
  expect(
    content.items.map((i) => ("str" in i ? i.str : "")).join(""),
  ).toContain("เอกสารทดสอบภาษาไทย");
  expect((await pdf.getPage(2)).rotate).toBe(90);
  await task.destroy();
  await page.locator("[data-next]").click();
  await expect(page.locator("[data-page]")).toHaveText("2 / 2");
  await expect(page.locator("[data-preview-status]")).toBeEmpty();
  await page.locator('[data-view="original"]').click();
  await expect(page.locator('[data-view="original"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "artifacts/compress-result-mobile.png",
    fullPage: true,
  });
  await page.locator("[data-again]").click();
  await page.getByRole("radio", { name: /ไฟล์เล็ก/ }).check();
  await page.locator("[data-run]").click();
  await expect(page.locator("[data-download]")).toBeVisible({ timeout: 60000 });
  // Dismissing navigation must retain the result.
  page.once("dialog", (d) => d.dismiss());
  await page.locator('.site-navigation a[href="/"]').first().click();
  await expect(page).toHaveURL(/\/tools\/compress$/);
  await expect(page.locator("[data-download]")).toBeVisible();
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});
test("bad files recover and unchanged PDFs are not reported as savings", async ({
  page,
}) => {
  await open(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/compress-landing-mobile.png",
    fullPage: true,
  });
  await page.locator("[data-file]").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("bad"),
  });
  await expect(page.locator("[data-error]")).toContainText("เปิด PDF ไม่ได้");
  await expect(page.locator("[data-choose]")).toBeEnabled();
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.getForm();
  const buffer = Buffer.from(await doc.save());
  await page
    .locator("[data-file]")
    .setInputFiles({ name: "blank.pdf", mimeType: "application/pdf", buffer });
  await expect(page.locator("[data-run]")).toBeEnabled();
  await page.locator("[data-run]").click();
  await expect(page.locator("[data-saved]")).toHaveText("ไฟล์นี้เล็กอยู่แล้ว");
  const download = page.waitForEvent("download");
  await page.locator("[data-download]").click();
  expect(await readFile((await (await download).path())!)).toEqual(buffer);
});
