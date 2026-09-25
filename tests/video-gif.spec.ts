import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
function frames(bytes: Buffer) {
  let i = 13 + (bytes[10] & 128 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0),
    count = 0;
  const blocks = () => {
    while (bytes[i]) i += 1 + bytes[i];
    i++;
  };
  while (i < bytes.length && bytes[i] !== 0x3b) {
    const block = bytes[i++];
    if (block === 0x21) {
      i++;
      blocks();
    } else if (block === 0x2c) {
      const flags = bytes[i + 8];
      i += 9;
      if (flags & 128) i += 3 * (1 << ((flags & 7) + 1));
      i++;
      blocks();
      count++;
    } else throw new Error("Invalid GIF block");
  }
  return count;
}
for (const mobile of [false, true]) {
  test(`video GIF ${mobile ? "mobile" : "desktop"}: server conversion, trim, download and edit`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [],
      uploads: string[] = [],
      core: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.method() !== "GET") uploads.push(r.url());
      if (r.url().includes("ffmpeg-core")) core.push(r.url());
    });
    await page.goto("/tools/video-to-gif");
    await expect(
      page.getByRole("button", { name: "เลือกวิดีโอ", exact: true }),
    ).toBeEnabled();
    expect(core).toEqual([]);
    const file = page.locator("[data-file]");
    await file.setInputFiles({
      name: "broken.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("invalid"),
    });
    await expect(page.locator("[data-error]")).toBeVisible();
    await file.setInputFiles("tests/fixtures/gif-test.webm");
    await expect(page.locator("[data-workspace]")).toBeVisible();
    await expect(page.locator(".gif-seo")).toBeHidden();
    await expect(page.locator("[data-error]")).toBeHidden();
    expect(core).toEqual([]);
    await page.screenshot({
      path: `artifacts/video-gif-editor-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
    await page.locator("[data-start]").fill("0.5");
    await page.locator("[data-end]").fill("1.5");
    await expect(page.locator("[data-duration]")).toHaveText("1.0 วินาที");
    await page.locator("[data-create]").click();
    await expect(page.locator("[data-cancel]")).toHaveCount(0);
    await expect(page.locator("[data-result]")).toBeVisible({ timeout: 90000 });
    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: "ดาวน์โหลด GIF" }).click();
    const bytes = await readFile((await (await downloading).path())!);
    expect(bytes.subarray(0, 6).toString()).toMatch(/^GIF8[79]a$/);
    expect(bytes.readUInt16LE(6)).toBe(320);
    expect(bytes.readUInt16LE(8)).toBe(180);
    expect(frames(bytes)).toBeGreaterThanOrEqual(8);
    expect(frames(bytes)).toBeLessThanOrEqual(11);
    await page.screenshot({
      path: `artifacts/video-gif-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "ทำให้ไฟล์เล็กลง" }).click();
    await expect(page.locator("[data-result]")).toBeVisible({ timeout: 90000 });
    const smallerDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "ดาวน์โหลด GIF" }).click();
    const smallerBytes = await readFile(
      (await (await smallerDownload).path())!,
    );
    expect(smallerBytes.readUInt16LE(6)).toBeLessThan(bytes.readUInt16LE(6));
    await expect(page.locator("[data-status]")).toBeEmpty();
    await page.getByRole("button", { name: "แก้ไขช่วง" }).click();
    await expect(page.locator("[data-start]")).toHaveValue("0.5");
    await file.setInputFiles({
      name: "wrong.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("bad"),
    });
    await expect(page.locator("[data-workspace]")).toBeVisible();
    await expect(page.locator("[data-error]")).toBeVisible();
    expect(uploads.some((url) => url.includes("/api/media/"))).toBe(true);
    expect(errors).toEqual([]);
  });
}
test("video GIF landing is readable without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/tools/video-to-gif");
  await expect(
    page.getByRole("heading", { name: "แปลงวิดีโอเป็น GIF", exact: true }),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/tools\/video-to-gif$/,
  );
  await expect(page).toHaveTitle(
    "แปลงวิดีโอเป็น GIF ออนไลน์ฟรี | MP4 เป็น GIF — DocNory",
  );
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /MP4, MOV และ WebM/,
  );
  await expect(
    page.getByRole("heading", { name: "วิธีสร้าง GIF จากวิดีโอ" }),
  ).toBeVisible();
  await page.getByText("ทำไม GIF ถึงไม่มีเสียง?", { exact: true }).click();
  await expect(page.locator(".gif-seo-faq")).toContainText("ไม่รองรับเสียง");
  await context.close();
});
