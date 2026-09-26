import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function upload(page: import("@playwright/test").Page) {
  await page.goto("/tools/organize");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await page.locator("[data-files]").setInputFiles({
    name: "sample.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator(".organize-page")).toHaveCount(1);
  await expect(page.locator("[data-export]")).toBeEnabled();
}

test("leaving uses the shared modal, preserves work on cancel and leaves without a second native prompt", async ({
  page,
}) => {
  await upload(page);
  let nativePrompts = 0;
  page.on("dialog", async (d) => {
    nativePrompts++;
    await d.dismiss();
  });
  const home = page.locator('.site-navigation a[href="/"]').first();
  await home.click();
  const modal = page.getByRole("dialog", { name: "ออกจากหน้านี้หรือไม่?" });
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "อยู่หน้านี้ต่อ" }),
  ).toBeFocused();
  await page.screenshot({ path: "artifacts/leave-modal-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".organize-page")).toHaveCount(1);
  await home.click();
  await modal.getByRole("button", { name: "อยู่หน้านี้ต่อ" }).click();
  await expect(page).toHaveURL(/\/tools\/organize$/);
  await home.click();
  await modal
    .getByRole("button", { name: "ออกจากหน้านี้", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  expect(nativePrompts).toBe(0);
});

test("mobile modal fits and reload retains native protection; downloaded work leaves directly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page);
  await page.locator('.site-navigation a[href="/"]').first().click();
  const modal = page.getByRole("dialog", { name: "ออกจากหน้านี้หรือไม่?" });
  await expect(modal).toBeVisible();
  const bounds = (await modal.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "artifacts/leave-modal-mobile.png" });
  await modal.getByRole("button", { name: "อยู่หน้านี้ต่อ" }).click();
  const prompt = page.waitForEvent("dialog");
  const reload = page.reload({ timeout: 2000 }).catch(() => {});
  const native = await prompt;
  expect(native.type()).toBe("beforeunload");
  await native.dismiss();
  await reload;
  await page.locator("[data-export]").click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลด PDF", exact: true })
    .click();
  await download;
  await page.locator('.site-navigation a[href="/"]').first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(modal).toHaveCount(0);
});

test("server upload keeps its job on cancel and releases it only after confirmed departure", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.addInitScript(() => {
    navigator.sendBeacon = (url) => {
      if (String(url).endsWith("/leave")) {
        sessionStorage.setItem(
          "test-leave-count",
          String(Number(sessionStorage.getItem("test-leave-count") ?? 0) + 1),
        );
      }
      return true;
    };
  });
  await page
    .context()
    .route("**/api/media", (route) =>
      route.fulfill({ json: { chunkSize: 1024 * 1024 } }),
    );
  await page.context().route("**/api/media/**", async (route) => {
    if (route.request().url().includes("/chunks?")) {
      await pending;
      await route.abort().catch(() => {});
    } else {
      await route.fulfill({ json: { chunkSize: 1024 * 1024 } });
    }
  });
  try {
    await page.goto("/tools/video-to-mp3");
    await expect(
      page.getByRole("button", { name: "เลือกวิดีโอ", exact: true }),
    ).toBeEnabled();
    await page
      .locator("[data-file]")
      .setInputFiles("tests/fixtures/audio-test.webm");
    const uploading = page.waitForRequest((r) => r.url().includes("/chunks?"));
    await page
      .getByRole("button", { name: "แปลงเป็น MP3", exact: true })
      .click();
    await uploading;
    await page.locator(".site-navigation .brand").click();
    const modal = page.getByRole("dialog", { name: "ออกจากหน้านี้หรือไม่?" });
    await modal.getByRole("button", { name: "อยู่หน้านี้ต่อ" }).click();
    expect(
      await page.evaluate(() => sessionStorage.getItem("test-leave-count")),
    ).toBeNull();
    await expect(page.locator("[data-progress]")).toBeVisible();
    await page.locator(".site-navigation .brand").click();
    await modal
      .getByRole("button", { name: "ออกจากหน้านี้", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    expect(
      await page.evaluate(() => sessionStorage.getItem("test-leave-count")),
    ).toBe("1");
  } finally {
    release();
  }
});
