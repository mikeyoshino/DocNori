import { expect, test } from "@playwright/test";

const tools = [
  "fill-sign",
  "merge",
  "organize",
  "split",
  "compress",
  "pdf-to-word",
  "pdf-to-jpg",
  "word-to-pdf",
  "video-to-gif",
  "video-to-mp3",
  "jpg-to-pdf",
  "heic-to-jpg",
  "compress-image",
];

test("every upload landing renders a spinner-only loading indicator before JavaScript starts", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    for (const tool of tools) {
      await page.goto(`/tools/${tool}`);
      const button = page.getByRole("button", {
        name: "กำลังเตรียมเครื่องมือ…",
        exact: true,
      });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute("aria-busy", "true");
      await expect(button.locator(".file-select-spinner")).toBeVisible();
      await expect(button.locator(".file-select-label")).toBeHidden();
      expect(
        await button
          .locator(".file-select-spinner")
          .evaluate((el) => getComputedStyle(el).animationName),
      ).toBe("none");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
    }
  } finally {
    await context.close();
  }
});

for (const [tool, label] of [
  ["fill-sign", "เลือกไฟล์ PDF"],
  ["merge", "เลือกไฟล์ PDF"],
  ["compress-image", "เลือกรูปภาพ"],
]) {
  test(`${tool} keeps the button stable while loading then opens the file chooser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let release!: () => void;
    const runtime = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      /\/_framework\/blazor\.web(?:\.[^/]+)?\.js(?:\?.*)?$/,
      async (route) => {
        await runtime;
        await route.continue();
      },
    );
    try {
      await page.goto(`/tools/${tool}`, { waitUntil: "commit" });
      const button = page.getByRole("button", {
        name: "กำลังเตรียมเครื่องมือ…",
        exact: true,
      });
      await expect(button).toBeDisabled();
      await expect(button.locator(".file-select-spinner")).toBeVisible();
      await expect(button.locator(".file-select-label")).toBeHidden();
      await page.evaluate(() => document.fonts.ready);
      const before = (await button.boundingBox())!;
      release();
      const ready = page.getByRole("button", { name: label, exact: true });
      await expect(ready).toBeEnabled();
      await expect(ready).toHaveAttribute("aria-busy", "false");
      await expect(ready.locator(".file-select-spinner")).toBeHidden();
      const after = (await ready.boundingBox())!;
      expect(Math.abs(after.width - before.width)).toBeLessThan(1);
      expect(Math.abs(after.height - before.height)).toBeLessThan(1);
      const chooser = page.waitForEvent("filechooser");
      await ready.click();
      expect(await chooser).toBeTruthy();
    } finally {
      release();
    }
  });
}
