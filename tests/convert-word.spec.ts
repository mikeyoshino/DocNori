import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

async function fixture(scan = false, mixed = false) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  if (!scan || mixed) {
    const p = pdf.addPage([595, 842]);
    p.drawText("Editable invoice 2026", { x: 45, y: 760, size: 18, font });
    p.drawText("Total", { x: 45, y: 680, size: 12, font });
    p.drawText("123", { x: 300, y: 680, size: 12, font });
    p.drawText("Customer: Alice & Bob", { x: 45, y: 720, size: 12, font });
  }
  if (scan) {
    const png = await pdf.embedPng(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const p = pdf.addPage([595, 842]);
    p.drawImage(png, { x: 45, y: 400, width: 200, height: 300 });
  }
  return {
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  };
}
async function open(page: Page) {
  await page.goto("/tools/pdf-to-word");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
}
async function output(page: Page) {
  const d = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลด Word", exact: true })
    .click();
  const file = await d;
  expect(file.suggestedFilename()).toMatch(/\.docx$/);
  return JSZip.loadAsync(await readFile((await file.path())!));
}

test("Word entry renders without JavaScript and OCR is clearly upcoming", async ({
  browser,
  request,
}) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto((await request.get("/tools/pdf-to-word")).url());
  await expect(
    page.getByRole("heading", { name: "PDF เป็น Word", exact: true }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index,follow",
  );
  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    "/tools/pdf-to-word",
  );
  await ctx.close();
});
test("exports editable DOCX locally and marks OCR unavailable", async ({
  page,
}) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") sent.push(r.url());
  });
  await open(page);
  await page.locator("[data-files]").setInputFiles(await fixture());
  await expect(page.locator("[data-summary]")).toContainText("1 หน้า");
  await expect(page.getByLabel("OCR สำหรับสมาชิกแบบชำระเงิน")).toBeDisabled();
  await expect(page.locator("[data-ocr-option]")).toContainText("เร็ว ๆ นี้");
  await page.screenshot({
    path: "artifacts/pdf-to-word-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "แปลงเป็น Word", exact: true })
    .click();
  const zip = await output(page);
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("Editable invoice 2026");
  expect(xml).toContain("Alice &amp; Bob");
  expect(xml).toContain("<w:t");
  expect(xml).toContain("<w:tab/>");
  expect(sent).toEqual([]);
  await page.getByRole("button", { name: "กลับไปตั้งค่า" }).click();
  await expect(page.locator("[data-summary]")).toContainText("1 หน้า");
});
test("warns for scanned pages, can return, then keeps scan as image alongside editable text", async ({
  page,
}) => {
  await open(page);
  await page.locator("[data-files]").setInputFiles(await fixture(true, true));
  await expect(page.locator("[data-scan-note]")).toBeVisible();
  await page
    .getByRole("button", { name: "แปลงเป็น Word", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "เอกสารนี้มีหน้าที่แก้ข้อความไม่ได้" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "กลับไปเลือกตัวเลือก" }).click();
  await expect(page.locator("[data-summary]")).toContainText("2 หน้า");
  await page
    .getByRole("button", { name: "แปลงเป็น Word", exact: true })
    .click();
  await page.getByRole("button", { name: "แปลงต่อโดยไม่ใช้ OCR" }).click();
  const zip = await output(page);
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("Editable invoice 2026");
  expect(xml).toContain("<w:drawing>");
  expect(
    Object.keys(zip.files).some(
      (n) => n.startsWith("word/media/") && !zip.files[n].dir,
    ),
  ).toBe(true);
  await expect(page.locator("[data-result-summary]")).toContainText(
    "1 หน้าเป็นรูปภาพ",
  );
});
test("bad input preserves source, mobile fits, reset clears data", async ({
  page,
}) => {
  await open(page);
  await page.locator("[data-files]").setInputFiles(await fixture());
  await expect(page.locator("[data-summary]")).toContainText("1 หน้า");
  await page.locator("[data-files]").setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("broken"),
  });
  await expect(page.locator("[data-error]")).toBeVisible();
  await expect(page.locator("[data-summary]")).toContainText("1 หน้า");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/pdf-to-word-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "ล้างรายการไฟล์" }).click();
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
});

test("Thai text remains editable, multiple PDFs download separately in ZIP, and cancellation retains inputs", async ({
  page,
}) => {
  const { exportPdf } =
    await import("../src/SabuySign.Web/Client/editor/pdf.ts");
  const base = await PDFDocument.create();
  base.addPage([595, 842]);
  const words = "น้ำ กุ้ง ปู่ ผู้รับรอง กำลัง ทดสอบภาษาไทย";
  const bytes = await exportPdf(
    await base.save(),
    [
      {
        id: "thai",
        page: 0,
        x: 45,
        y: 45,
        width: 500,
        height: 40,
        text: words,
        size: 18,
        color: "#172433",
        align: "left",
      },
    ],
    new Uint8Array(
      await readFile("src/SabuySign.Web/wwwroot/fonts/Sarabun-Regular.ttf"),
    ),
  );
  await open(page);
  await page.locator("[data-files]").setInputFiles([
    {
      name: "thai.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(bytes),
    },
    await fixture(),
  ]);
  await expect(page.locator("[data-summary]")).toContainText("2 ไฟล์");
  await page.evaluate(() => {
    const label = document.querySelector("[data-progress-label]")!;
    const watch = new MutationObserver(() => {
      if (label.textContent?.includes("thai.pdf")) {
        watch.disconnect();
        (document.querySelector("[data-cancel]") as HTMLButtonElement).click();
      }
    });
    watch.observe(label, { childList: true, subtree: true });
  });
  await page
    .getByRole("button", { name: "แปลงเป็น Word", exact: true })
    .click();
  await expect(page.locator("[data-status]")).toContainText("ยกเลิก");
  await expect(page.locator("[data-summary]")).toContainText("2 ไฟล์");
  await page
    .getByRole("button", { name: "แปลงเป็น Word", exact: true })
    .click();
  const d = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลด Word (ZIP)", exact: true })
    .click();
  const file = await d;
  const zip = await JSZip.loadAsync(await readFile((await file.path())!));
  expect(Object.keys(zip.files)).toHaveLength(2);
  const thai = await JSZip.loadAsync(
    await zip.file("document-01.docx")!.async("uint8array"),
  );
  const xml = await thai.file("word/document.xml")!.async("string");
  expect(xml).toContain(words);
  await (
    await import("node:fs/promises")
  ).writeFile(
    "artifacts/pdf-to-word-thai.docx",
    await zip.file("document-01.docx")!.async("uint8array"),
  );
});
