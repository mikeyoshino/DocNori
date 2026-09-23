import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, rgb, degrees } from "pdf-lib";
import { readFile } from "node:fs/promises";

async function pdfFile(name = "เอกสาร.pdf", pages = 1) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([144, 216]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 144,
      height: 216,
      color: rgb(1, 0, 0),
    });
  }
  return {
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  };
}
async function open(page: Page) {
  await page.goto("/tools/pdf-to-jpg");
  await expect(
    page.getByRole("heading", { name: "PDF เป็น JPG", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
}
async function imageInfo(page: Page, bytes: Buffer) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/jpeg" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixel = [...context.getImageData(0, 0, 1, 1).data];
    const ink = [...context.getImageData(10, 10, 1, 1).data];
    bitmap.close();
    return { width: canvas.width, height: canvas.height, pixel, ink };
  }, bytes.toString("base64"));
}
function unzip(bytes: Buffer) {
  const files: { name: string; bytes: Buffer }[] = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18),
      nameLength = bytes.readUInt16LE(offset + 26),
      extra = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extra;
    files.push({
      name: bytes.subarray(offset + 30, offset + 30 + nameLength).toString(),
      bytes: bytes.subarray(start, start + length),
    });
    offset = start + length;
  }
  return files;
}

test("JPG entry is SSR and grouped with future PDF conversion tools", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto((await request.get("/tools/pdf-to-jpg")).url());
  await expect(
    page.getByRole("heading", { name: "PDF เป็น JPG", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/PDF เป็น JPG/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index,follow",
  );
  await page
    .locator("summary")
    .filter({ hasText: "เครื่องมือทั้งหมด" })
    .click();
  const group = page.locator(".all-tools-dropdown .nav-tool-group").filter({
    has: page.getByRole("heading", { name: "แปลงจาก PDF", exact: true }),
  });
  await expect(group.getByRole("link")).toHaveCount(4);
  await expect(
    group.getByRole("link", { name: /PDF เป็น JPG/ }),
  ).toHaveAttribute("href", "/tools/pdf-to-jpg");
  await expect(group.getByRole("link", { name: /PowerPoint/ })).toContainText(
    "เร็ว ๆ นี้",
  );
  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    "/tools/pdf-to-jpg",
  );
  await context.close();
});

test("page conversion exports real normal JPG and high-quality rotated ZIP locally", async ({
  page,
}) => {
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") uploads.push(r.url());
  });
  await open(page);
  await page.locator("[data-files]").setInputFiles(await pdfFile());
  await expect(page.locator("[data-summary]")).toContainText("1 หน้า");
  await page.screenshot({
    path: "artifacts/pdf-to-jpg-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "แปลงเป็น JPG", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "แปลงเป็น JPG เรียบร้อยแล้ว" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/pdf-to-jpg-result.png",
    fullPage: true,
  });
  const first = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลด JPG", exact: true })
    .click();
  const download = await first;
  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  const normal = await imageInfo(
    page,
    await readFile((await download.path())!),
  );
  expect([normal.width, normal.height]).toEqual([300, 450]);
  expect(normal.pixel[0]).toBeGreaterThan(240);
  expect(normal.pixel[1]).toBeLessThan(15);
  await page.getByRole("button", { name: "กลับไปตั้งค่า" }).click();
  const pdf = await PDFDocument.create();
  const cropped = pdf.addPage([288, 432]);
  cropped.setCropBox(0, 0, 144, 216);
  cropped.setRotation(degrees(90));
  await page
    .getByRole("button", { name: "เพิ่มไฟล์ PDF", exact: true })
    .hover();
  await expect(
    page.getByRole("button", { name: "เพิ่มไฟล์ PDF", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  const choosing = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "เลือกไฟล์จากเครื่อง", exact: true })
    .click();
  await (
    await choosing
  ).setFiles({
    name: "rotated.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole("radio", { name: /สูง/ }).check();
  await page.getByRole("button", { name: "แปลงเป็น JPG", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "แปลงเป็น JPG เรียบร้อยแล้ว" }),
  ).toBeVisible();
  const next = page.waitForEvent("download");
  await page.getByRole("button", { name: /ดาวน์โหลดรูปภาพ.*ZIP/ }).click();
  const zipped = await next;
  const files = unzip(await readFile((await zipped.path())!));
  expect(files).toHaveLength(2);
  expect(new Set(files.map((f) => f.name)).size).toBe(2);
  const high = await imageInfo(page, files[0].bytes),
    rotated = await imageInfo(page, files[1].bytes);
  expect([high.width, high.height]).toEqual([600, 900]);
  expect([rotated.width, rotated.height]).toEqual([900, 600]);
  expect(uploads).toEqual([]);
  await page.getByRole("button", { name: "แปลงไฟล์อื่น" }).click();
  await expect(page.locator("[data-intro]")).toBeVisible();
  await expect(page.locator("[data-list] li")).toHaveCount(0);
});

test("large pages fail safely and keep the selected PDF available", async ({
  page,
}) => {
  await open(page);
  const pdf = await PDFDocument.create();
  pdf.addPage([3000, 3000]);
  await page.locator("[data-files]").setInputFiles({
    name: "large-page.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole("button", { name: "แปลงเป็น JPG", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ภาพมีขนาดใหญ่เกินไป");
  await expect(page.locator("[data-list] li")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "แปลงเป็น JPG", exact: true }),
  ).toBeEnabled();
});

test("extracts embedded raster images and handles PDFs with no images", async ({
  page,
}) => {
  await open(page);
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 24;
    c.getContext("2d")!.fillRect(8, 8, 8, 8);
    return c.toDataURL("image/png").split(",")[1];
  });
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(Buffer.from(png, "base64"));
  const sheet = pdf.addPage([144, 216]);
  sheet.drawImage(image, { x: 10, y: 10, width: 64, height: 48 });
  sheet.drawImage(image, { x: 10, y: 80, width: 32, height: 24 });
  await page.locator("[data-files]").setInputFiles({
    name: "images.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole("radio", { name: /ดึงรูปภาพใน PDF/ }).check();
  await expect(page.locator("[data-quality]")).toBeHidden();
  await page.getByRole("button", { name: "แปลงเป็น JPG", exact: true }).click();
  await expect(page.locator("[data-result-summary]")).toContainText("1 รูป");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลด JPG", exact: true })
    .click();
  const result = await imageInfo(
    page,
    await readFile((await (await event).path())!),
  );
  expect([result.width, result.height]).toEqual([32, 24]);
  expect(result.pixel).toEqual([255, 255, 255, 255]);
  expect(result.ink[0]).toBeLessThan(20);
  await page.getByRole("button", { name: "แปลงไฟล์อื่น" }).click();
  await page.locator("[data-files]").setInputFiles(await pdfFile());
  await page.getByRole("radio", { name: /ดึงรูปภาพใน PDF/ }).check();
  await page.getByRole("button", { name: "แปลงเป็น JPG", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ไม่พบรูปภาพ");
  await expect(page.locator("[data-workspace]")).toBeVisible();
  await expect(page.locator("[data-list] li")).toHaveCount(1);
});

test("recovers from bad files, cancels conversion and fits mobile", async ({
  page,
}) => {
  await open(page);
  await page
    .locator("[data-files]")
    .setInputFiles(await pdfFile("original.pdf", 10));
  await expect(
    page.getByRole("button", { name: "แปลงเป็น JPG", exact: true }),
  ).toBeEnabled();
  await page.locator("[data-files]").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("broken"),
  });
  await expect(page.getByRole("alert")).toContainText("เปิดไม่ได้");
  await expect(page.locator("[data-list] li")).toHaveCount(1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const label = document.querySelector("[data-progress-label]")!;
        const observer = new MutationObserver(() => {
          // Cancel after PDF.js has opened the file and started a real page.
          if (!label.textContent?.includes("original.pdf")) return;
          observer.disconnect();
          (
            document.querySelector("[data-cancel]") as HTMLButtonElement
          ).click();
          resolve();
        });
        observer.observe(label, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        (document.querySelector("[data-convert]") as HTMLButtonElement).click();
      }),
  );
  await expect(page.locator("[data-workspace]")).toBeVisible();
  await expect(page.locator("[data-status]")).toContainText("ยกเลิก");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "artifacts/pdf-to-jpg-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "ลบ original.pdf", exact: true })
    .click();
  await expect(page.locator("[data-intro]")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-list] li")).toHaveCount(0);
});
