import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("[data-choose]").first()).toBeEnabled({
    timeout: 30000,
  });
}
async function image(
  page: Page,
  w: number,
  h: number,
  color: string,
  type = "image/png",
) {
  return Buffer.from(
    await page.evaluate(
      ({ w, h, color, type }) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        return c.toDataURL(type, 0.95).split(",")[1];
      },
      { w, h, color, type },
    ),
    "base64",
  );
}
test("image tools have separate SSR landing pages and no advertising scripts", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const [path, name] of [
    ["jpg-to-pdf", "JPG / PNG เป็น PDF"],
    ["heic-to-jpg", "HEIC เป็น JPG"],
  ]) {
    await page.goto("/tools/" + path);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp("/tools/" + path + "$"),
    );
    await expect(page.locator("[data-intro]")).toContainText("20 ไฟล์");
    await expect(page.locator('script[src*="adsbygoogle"]')).toHaveCount(0);
  }
  await context.close();
});
test("JPG PNG batch reorders rotates previews and saves local PDF", async ({
  page,
}) => {
  const errors: string[] = [],
    posts: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) posts.push(r.url());
  });
  await open(page, "/tools/jpg-to-pdf");
  const red = await image(page, 400, 600, "#e52222"),
    blue = await image(page, 600, 400, "#2244dd", "image/jpeg");
  await page.locator("[data-files]").setInputFiles([
    { name: "หน้าแรก.png", mimeType: "image/png", buffer: red },
    { name: "หน้าสอง.jpg", mimeType: "image/jpeg", buffer: blue },
  ]);
  await expect(page.locator(".image-card")).toHaveCount(2);
  await expect(page.locator("[data-convert]")).toBeEnabled();
  await page.getByRole("button", { name: "เลื่อนไปก่อน หน้าสอง.jpg" }).click();
  await expect(page.locator(".image-card").first()).toContainText(
    "หน้าสอง.jpg",
  );
  await page.getByRole("button", { name: "หมุนรูป หน้าแรก.png" }).click();
  await page.locator("[data-convert]").click();
  await expect(page.locator("[data-download]")).toBeVisible({ timeout: 30000 });
  await page.locator("[data-view-pdf]").click();
  await expect(page.locator("[data-canvas] canvas")).toBeVisible();
  await expect(page.locator("[data-page]")).toHaveText("1 / 2");
  await page.locator("[data-next]").click();
  await expect(page.locator("[data-page]")).toHaveText("2 / 2");
  await page.locator("[data-close]").click();
  const download = page.waitForEvent("download");
  await page.locator("[data-download]").click();
  const bytes = await readFile((await (await download).path())!);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(2);
  for (const p of doc.getPages())
    expect(p.getWidth()).toBeGreaterThan(p.getHeight());
  await page.screenshot({
    path: "artifacts/images-pdf-desktop.png",
    fullPage: true,
  });
  await page.getByRole("radio", { name: "แนวตั้ง", exact: true }).check();
  await expect(page.locator("[data-download]")).toBeHidden();
  await page.locator("[data-convert]").click();
  await expect(page.locator("[data-download]")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/images-pdf-mobile.png",
    fullPage: true,
  });
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});
test("HEIC batch decodes real files locally with duplicate-safe ZIP and partial failures", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [],
    posts: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) posts.push(r.url());
  });
  await open(page, "/tools/heic-to-jpg");
  const buffer = await readFile("tests/fixtures/image-colors.heic");
  await page.locator("[data-files]").setInputFiles([
    { name: "รูป.heic", mimeType: "image/heic", buffer },
    { name: "รูป.heic", mimeType: "image/heic", buffer },
    { name: "เสีย.heic", mimeType: "image/heic", buffer: Buffer.from("bad") },
  ]);
  await expect(page.locator(".image-card")).toHaveCount(3);
  await page.locator("[data-convert]").click();
  await expect(page.locator("[data-progress]")).toHaveText(
    "แปลงสำเร็จ 2 / 3 รูป",
    { timeout: 60000 },
  );
  await expect(page.locator(".image-file-error")).toHaveCount(1);
  await expect(page.locator(".image-thumb img")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page.locator("[data-zip]").click();
  const zip = await JSZip.loadAsync(
    await readFile((await (await download).path())!),
  );
  expect(Object.keys(zip.files)).toEqual(["รูป.jpg", "รูป-2.jpg"]);
  const jpg = await zip.files["รูป.jpg"].async("uint8array");
  expect([...jpg.slice(0, 2)]).toEqual([255, 216]);
  const dimensions = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
      );
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const red = [...ctx.getImageData(20, 20, 1, 1).data],
        blue = [...ctx.getImageData(300, 20, 1, 1).data];
      bitmap.close();
      return { w: c.width, h: c.height, red, blue };
    },
    [...jpg],
  );
  expect(dimensions.w).toBe(320);
  expect(dimensions.h).toBe(240);
  expect(dimensions.red[0]).toBeGreaterThan(dimensions.red[2] + 80);
  expect(dimensions.blue[2]).toBeGreaterThan(dimensions.blue[0] + 80);
  await page.screenshot({ path: "artifacts/heic-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/heic-mobile.png", fullPage: true });
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});
