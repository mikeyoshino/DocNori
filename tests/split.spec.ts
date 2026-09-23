import { test, expect } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
test("split downloads selected and remaining pages, validates ranges and keeps valid source after errors", async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  for (const width of [200, 300, 400, 500]) {
    const p = doc.addPage([width, 600]);
    p.drawRectangle({
      x: 20,
      y: 100,
      width: 100,
      height: 100,
      color: rgb(0.1, 0.4, 0.8),
    });
    p.drawText(`Page ${width / 100 - 1}`, { x: 20, y: 500, size: 18 });
  }
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") requests.push(r.url());
  });
  await page.goto("/tools/split");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  await page.locator("input[type=file]").setInputFiles({
    name: "source.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await page.getByRole("button", { name: "เลือกหน้า", exact: true }).click();
  const range = page.getByLabel("หน้าที่ต้องการแยก", { exact: true });
  await expect(range).toBeVisible();
  const selected = page.getByRole("button", {
    name: "แยก PDF",
    exact: true,
  });
  const remaining = page.getByRole("button", {
    name: "ดาวน์โหลดหน้าที่เหลือ",
    exact: true,
  });
  await range.fill("5");
  await expect(selected).toBeDisabled();
  await expect(range).toHaveAttribute("aria-invalid", "true");
  await range.fill("1-4");
  await expect(remaining).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "เลือกหน้า 4", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-preview-status]")).toContainText("คลิกภาพ");
  await page.getByRole("button", { name: "เลือกหน้า 2", exact: true }).click();
  await expect(range).toHaveValue("1, 3, 4");
  await page.getByRole("button", { name: "ขยายหน้า 3", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("dialog canvas").evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.locator("dialog canvas").evaluate((c: HTMLCanvasElement) => {
        const data = c
          .getContext("2d")!
          .getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < data.length; i += 4)
          if (data[i + 2] > 150 && data[i] < 80 && data[i + 3] > 0) return true;
        return false;
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await range.fill("1, 3");
  await expect(
    page.getByRole("button", { name: "เลือกหน้า 3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "เลือกหน้า 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("bad"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(range).toHaveValue("1, 3");
  for (const [button, widths, filename] of [
    [selected, [200, 400], "source-split.pdf"],
    [remaining, [300, 500], "source-remaining.pdf"],
  ] as const) {
    const pending = page.waitForEvent("download");
    await button.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(filename);
    const output = await PDFDocument.load(
      await readFile((await download.path())!),
    );
    expect(output.getPages().map((p) => p.getWidth())).toEqual(widths);
  }
  expect(requests).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/split-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/split-mobile.png", fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page
    .getByRole("button", { name: "ล้างไฟล์และเริ่มใหม่", exact: true })
    .click();
  await expect(range).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeVisible();
});

test("split workspace groups ranges, downloads ZIP, combines and divides by fixed page count", async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  for (const width of [200, 300, 400, 500]) {
    const p = doc.addPage([width, 600]);
    p.drawText(`Document page ${width / 100 - 1}`, { x: 20, y: 500, size: 14 });
    p.drawRectangle({
      x: 20,
      y: 100,
      width: 100,
      height: 100,
      color: rgb(0.1, 0.4, 0.8),
    });
  }
  await page.goto("/tools/split");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  await page.locator("input[type=file]").setInputFiles({
    name: "ranges.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  const from = page.getByRole("spinbutton", {
    name: "จากหน้า ช่วงที่ 1",
    exact: true,
  });
  const to = page.getByRole("spinbutton", {
    name: "ถึงหน้า ช่วงที่ 1",
    exact: true,
  });
  await expect(from).toHaveValue("1");
  await expect(to).toHaveValue("4");
  await to.fill("2");
  await page
    .getByRole("button", { name: "＋ เพิ่มช่วงหน้า", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "จากหน้า ช่วงที่ 2", exact: true }),
  ).toHaveValue("3");
  await expect(page.locator(".split-preview-group")).toHaveCount(2);
  await expect(page.locator("[data-selection]")).toContainText("2 ไฟล์");
  const downloadButton = page.getByRole("button", {
    name: "แยก PDF",
    exact: true,
  });
  let pending = page.waitForEvent("download");
  await downloadButton.click();
  let download = await pending;
  expect(download.suggestedFilename()).toBe("ranges-split.zip");
  await download.saveAs("artifacts/split-ranges.zip");
  const zip = await readFile((await download.path())!);
  let offset = 0;
  const widths: number[][] = [];
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const length = zip.readUInt32LE(offset + 18),
      start =
        offset +
        30 +
        zip.readUInt16LE(offset + 26) +
        zip.readUInt16LE(offset + 28);
    const pdf = await PDFDocument.load(zip.subarray(start, start + length));
    widths.push(pdf.getPages().map((p) => p.getWidth()));
    offset = start + length;
  }
  expect(widths).toEqual([
    [200, 300],
    [400, 500],
  ]);
  await page.getByLabel("รวมทุกช่วงเป็น PDF เดียว", { exact: true }).check();
  pending = page.waitForEvent("download");
  await downloadButton.click();
  download = await pending;
  expect(download.suggestedFilename()).toBe("ranges-split.pdf");
  expect(
    (
      await PDFDocument.load(await readFile((await download.path())!))
    ).getPageCount(),
  ).toBe(4);
  await page
    .getByRole("button", { name: "จำนวนหน้าคงที่", exact: true })
    .click();
  await page.getByLabel("แบ่งทุก ๆ กี่หน้า", { exact: true }).fill("3");
  await expect(page.locator(".split-preview-group")).toHaveCount(2);
  await expect(page.locator(".split-preview-group").last()).toContainText(
    "หน้า 4–4",
  );
  await page.getByRole("button", { name: "กำหนดเอง", exact: true }).click();
  await to.fill("0");
  await expect(downloadButton).toBeDisabled();
  await to.fill("2");
  await page.getByLabel("รวมทุกช่วงเป็น PDF เดียว", { exact: true }).uncheck();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/split-workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/split-workspace-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "ลบช่วงที่ 2", exact: true }).click();
  await expect(page.locator(".split-preview-group")).toHaveCount(1);
});
