import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import JSZip from "jszip";
test("Word landing is server rendered and available in convert navigation", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/tools/word-to-pdf");
  await expect(
    page.getByRole("heading", { name: "แปลง Word เป็น PDF", exact: true }),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/tools\/word-to-pdf$/,
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /ภาษาไทย/,
  );
  await expect(page.locator("[data-intro]")).toContainText("50 MB");
  await context.close();
});
test("batch Word conversion preserves Thai, tables and page breaks with preview and UTF-8 ZIP", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tools/word-to-pdf");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ Word", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  const buffer = await readFile("tests/fixtures/word-thai.docx");
  await page.locator("[data-files]").setInputFiles([
    {
      name: "เอกสาร.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer,
    },
    {
      name: "เอกสาร.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer,
    },
    {
      name: "broken.docx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("invalid"),
    },
  ]);
  await expect(page.locator(".wp-file")).toHaveCount(3);
  await page.getByRole("button", { name: "แปลงเป็น PDF", exact: true }).click();
  await expect(page.locator(".wp-file.is-ready")).toHaveCount(2, {
    timeout: 150000,
  });
  await expect(page.locator(".wp-file.is-error")).toHaveCount(1, {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "ลองแปลงไฟล์ที่เหลืออีกครั้ง" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "ดูตัวอย่าง", exact: true })
    .first()
    .click();
  await expect(page.locator("[data-page]")).toHaveText("หน้า 1 / 2", {
    timeout: 30000,
  });
  await page.screenshot({ path: "artifacts/word-pdf-preview-desktop.png" });
  await page.getByRole("button", { name: "หน้าถัดไป", exact: true }).click();
  await expect(page.locator("[data-page]")).toHaveText("หน้า 2 / 2");
  const download = page.waitForEvent("download");
  await page.locator("[data-preview-download]").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("เอกสาร.pdf");
  const bytes = await readFile((await file.path())!);
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  expect(pdf.numPages).toBe(2);
  const content = await (await pdf.getPage(1)).getTextContent();
  const text = content.items.map((i) => ("str" in i ? i.str : "")).join("");
  expect(text).toContain("เอกสารทดสอบภาษาไทย");
  expect(text).toContain("รายการ");
  expect(text).toContain("123");
  expect(text).toContain("น้ำ");
  await task.destroy();
  await page.getByRole("button", { name: "ปิดตัวอย่าง" }).click();
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "ดาวน์โหลดทั้งหมด (ZIP)" }).click();
  const zip = await JSZip.loadAsync(
    await readFile((await (await zipDownload).path())!),
  );
  expect(Object.keys(zip.files)).toEqual(["เอกสาร.pdf", "เอกสาร (2).pdf"]);
  await page.screenshot({
    path: "artifacts/word-pdf-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/word-pdf-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "ดูตัวอย่าง", exact: true })
    .first()
    .click();
  await expect(page.locator("[data-page]")).toHaveText("หน้า 1 / 2");
  await page.screenshot({ path: "artifacts/word-pdf-preview-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-preview]")).not.toBeVisible();
  await page
    .getByRole("button", { name: "นำไฟล์ออก", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "นำไฟล์ออก", exact: true })
    .last()
    .click();
  await expect(page.locator("[data-single-download]")).toBeVisible();
  await expect(page.locator("[data-single-download]")).toHaveAttribute(
    "download",
    "เอกสาร.pdf",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "เลือกไฟล์ชุดใหม่", exact: true })
    .click();
  await expect(page.locator("[data-intro]")).toBeVisible();
  expect(errors).toEqual([]);
});
test("file selection validates types and ten-file limit and can remove files", async ({
  page,
}) => {
  await page.goto("/tools/word-to-pdf");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ Word", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.locator("[data-files]").setInputFiles([
    {
      name: "not-word.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("a"),
    },
  ]);
  await expect(page.locator("[data-error]")).toContainText("DOC หรือ DOCX");
  await page.locator("[data-files]").setInputFiles(
    Array.from({ length: 11 }, (_, i) => ({
      name: `word${i}.docx`,
      mimeType: "application/octet-stream",
      buffer: Buffer.from("a"),
    })),
  );
  await expect(page.locator(".wp-file")).toHaveCount(10);
  await expect(page.locator("[data-error]")).toContainText("สูงสุด 10");
  await page
    .getByRole("button", { name: "นำไฟล์ออก", exact: true })
    .first()
    .click();
  await expect(page.locator(".wp-file")).toHaveCount(9);
});
test("leaving a partially converted batch confirms once and cancelling navigation preserves its active job", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const jobs: { url: string; token: string }[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/media\/[\da-f-]+$/.test(r.url()))
      jobs.push({ url: r.url(), token: r.headers()["authorization"] });
  });
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let held = false;
  await page.route("**/api/media/*/complete", async (route) => {
    if (jobs.length === 2) {
      held = true;
      await hold;
    }
    try {
      await route.continue();
    } catch {}
  });
  await page.goto("/tools/word-to-pdf");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ Word", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  const buffer = await readFile("tests/fixtures/word-thai.docx");
  await page.locator("[data-files]").setInputFiles([
    { name: "one.docx", mimeType: "application/octet-stream", buffer },
    { name: "two.docx", mimeType: "application/octet-stream", buffer },
  ]);
  await page.getByRole("button", { name: "แปลงเป็น PDF", exact: true }).click();
  await expect(page.locator(".wp-file.is-ready")).toHaveCount(1, {
    timeout: 90000,
  });
  await expect.poll(() => held).toBe(true);
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.type());
    await d.dismiss();
  });
  await page.locator(".nav-organize summary").click();
  const link = page.locator('.organize-nav-dropdown a[href="/tools/merge"]');
  await link.click();
  await page
    .getByRole("dialog", { name: "ออกจากหน้านี้หรือไม่?" })
    .getByRole("button", { name: "อยู่หน้านี้ต่อ" })
    .click();
  await expect(page).toHaveURL(/word-to-pdf/);
  expect(
    (
      await (
        await request.get(jobs[1].url, {
          headers: { Authorization: jobs[1].token },
        })
      ).json()
    ).state,
  ).toBe("uploading");
  if (
    !(await page.locator(".nav-organize").getAttribute("open")) &&
    !(await link.isVisible())
  )
    await page.locator(".nav-organize summary").click();
  await link.click();
  await page
    .getByRole("dialog", { name: "ออกจากหน้านี้หรือไม่?" })
    .getByRole("button", { name: "ออกจากหน้านี้", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tools\/merge$/);
  release();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(jobs[1].url, {
              headers: { Authorization: jobs[1].token },
            })
          ).json()
        ).state,
    )
    .toBe("cancelled");
  expect(dialogs).toEqual([]);
});
