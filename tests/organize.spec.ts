import { expect, test } from "@playwright/test";
import { PDFDocument, degrees } from "pdf-lib";
import { readFile } from "node:fs/promises";
async function fixture(name: string, widths: number[], rotation = 0) {
  const doc = await PDFDocument.create();
  for (const w of widths) {
    const p = doc.addPage([w, w + 200]);
    p.setRotation(degrees(rotation));
    p.drawText(`Page width ${w}`, { x: 20, y: 80, size: 12 });
  }
  return {
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  };
}
test("organize has an SSR landing, a grouped menu and no advertising scripts", async ({
  browser,
  baseURL,
  request,
}) => {
  const ctx = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const p = await ctx.newPage();
    await p.goto("/tools/organize");
    await expect(p).toHaveTitle(/จัดหน้า PDF ออนไลน์/);
    await expect(
      p.getByRole("heading", { name: "จัดหน้า PDF", exact: true }),
    ).toBeVisible();
    await expect(p.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index,follow",
    );
    await expect(p.locator('script[src*="adsbygoogle"]')).toHaveCount(0);
    await expect(p.locator(".organize-nav-dropdown a")).toHaveCount(3);
    await expect(
      p.locator('.organize-nav-dropdown a[href="/tools/organize"]'),
    ).toHaveCount(1);
    const sitemap = await request.get("/sitemap.xml");
    expect(await sitemap.text()).toContain("/tools/organize");
  } finally {
    await ctx.close();
  }
});
test("reorder, rotate, duplicate, delete, undo and blank pages produce the matching PDF locally", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tools/organize");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  await page
    .locator("[data-files]")
    .setInputFiles([
      await fixture("a.pdf", [300, 400]),
      await fixture("b.pdf", [200], 90),
    ]);
  const cards = page.locator(".organize-page");
  await expect(cards).toHaveCount(3);
  await expect(page.locator("[data-export]")).toBeEnabled();
  expect(
    await cards
      .first()
      .locator("canvas")
      .evaluate((c: HTMLCanvasElement) => c.width),
  ).toBeGreaterThan(0);
  await cards.nth(2).dragTo(cards.first());
  await expect(cards.first().locator(".organize-page-origin")).toHaveText(
    "b.pdf · หน้า 1",
  );
  await page.getByRole("button", { name: "หมุนหน้า 1", exact: true }).click();
  await page
    .getByRole("button", { name: "ทำสำเนาหน้า 1", exact: true })
    .click();
  await expect(cards).toHaveCount(4);
  await page.getByRole("button", { name: "ลบหน้า 3", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(cards).toHaveCount(4);
  await page.getByRole("button", { name: "ทำซ้ำ", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await page
    .getByRole("checkbox", { name: "เลือกหน้า 2", exact: true })
    .check();
  await page.getByRole("button", { name: "เพิ่มหน้าว่าง A4" }).click();
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(2)).toContainText("หน้าว่าง A4");
  await page.getByRole("button", { name: "ขยายหน้า 1", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("[data-preview-status]")).toHaveText("");
  await page.getByRole("button", { name: "ปิดตัวอย่าง" }).click();
  await page.screenshot({
    path: "artifacts/organize-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "จัดหน้า PDF", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "จัดหน้า PDF เรียบร้อยแล้ว" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลด PDF", exact: true })
    .click();
  const output = await PDFDocument.load(
    await readFile((await (await download).path())!),
  );
  expect(output.getPages().map((p) => Math.round(p.getWidth()))).toEqual([
    200, 200, 595, 400,
  ]);
  expect(output.getPages().map((p) => p.getRotation().angle)).toEqual([
    180, 180, 0, 0,
  ]);
  expect(output.getPage(0).node.Contents()).toBeTruthy();
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "กลับไปจัดหน้า" }).click();
  await expect(cards).toHaveCount(4);
  await page.locator("[data-export]").click();
  await expect(
    page.getByRole("heading", { name: "จัดหน้า PDF เรียบร้อยแล้ว" }),
  ).toBeVisible();
  const extra = await fixture("extra.pdf", [250]);
  const transfer = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(bytes)], "extra.pdf", {
        type: "application/pdf",
      }),
    );
    return data;
  }, Array.from(extra.buffer));
  await page
    .locator(".organize-tool")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  await expect(cards).toHaveCount(5);
  await expect(page.locator("[data-export]")).toBeVisible();
  await expect(page.locator("[data-export]")).toBeEnabled();
  await page.locator("[data-export]").click();
  const updatedDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลด PDF", exact: true })
    .click();
  const updated = await PDFDocument.load(
    await readFile((await (await updatedDownload).path())!),
  );
  expect(updated.getPageCount()).toBe(5);
  expect(updated.getPage(4).getWidth()).toBe(250);
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});
test("mobile controls preserve work on invalid input and support empty, undo, reset and leaving", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/organize");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  await page
    .locator("[data-files]")
    .setInputFiles(await fixture("mobile.pdf", [300, 400]));
  const cards = page.locator(".organize-page");
  await expect(cards).toHaveCount(2);
  await expect(page.locator("[data-export]")).toBeEnabled();
  await page
    .getByRole("button", { name: "เลื่อนก่อนหน้า 2", exact: true })
    .click();
  await expect(cards.first()).toContainText("หน้า 2");
  await page.locator("[data-files]").setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.locator("[data-error]")).toContainText(
    "อ่านไฟล์ PDF ไม่สำเร็จ",
  );
  await expect(cards).toHaveCount(2);
  await page.getByRole("button", { name: "เลือกทั้งหมด", exact: true }).click();
  await page.getByRole("button", { name: "ลบหน้า", exact: true }).click();
  await expect(cards).toHaveCount(0);
  await expect(page.locator("[data-export]")).toBeDisabled();
  await expect(page.locator("[data-empty]")).toBeVisible();
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await page.getByRole("button", { name: "คืนค่าเดิม", exact: true }).click();
  await expect(cards.first()).toContainText("หน้า 1");
  await page.screenshot({
    path: "artifacts/organize-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeVisible();
  await expect(cards).toHaveCount(0);
  await page
    .locator("[data-files]")
    .setInputFiles(await fixture("new.pdf", [250]));
  await expect(cards).toHaveCount(1);
});
