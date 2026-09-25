import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("video to MP3 converts on server, plays output and handles a silent video", async ({
  page,
}) => {
  test.setTimeout(120000);
  const writes: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tools/video-to-mp3");
  await expect(
    page.getByRole("button", { name: "เลือกวิดีโอ", exact: true }),
  ).toBeEnabled();
  await page
    .locator("[data-file]")
    .setInputFiles("tests/fixtures/audio-test.webm");
  await expect(page.locator("[data-workspace]")).toBeVisible();
  await page.getByRole("button", { name: "แปลงเป็น MP3", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ยกเลิก", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("[data-result]")).toBeVisible({ timeout: 90000 });
  const audio = page.locator("audio");
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration))
    .toBeGreaterThan(1.8);
  expect(
    await audio.evaluate((a: HTMLAudioElement) => a.duration),
  ).toBeLessThan(2.5);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "ดาวน์โหลด MP3" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("audio-test.mp3");
  const bytes = await readFile((await file.path())!);
  expect(bytes.length).toBeGreaterThan(10000);
  expect(bytes.subarray(0, 3).toString()).toBe("ID3");
  await page.screenshot({
    path: "artifacts/video-audio-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/video-audio-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator("[data-file]")
    .setInputFiles("tests/fixtures/gif-test.webm");
  await page.getByRole("button", { name: "แปลงเป็น MP3", exact: true }).click();
  await expect(page.locator("[data-error]")).toContainText("ไม่มีเสียง", {
    timeout: 90000,
  });
  await expect(page.locator("[data-workspace]")).toBeVisible();
  expect(writes.some((url) => url.includes("/api/media/"))).toBe(true);
  expect(errors).toEqual([]);
});
test("audio landing has SSR content and clear category names", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/tools/video-to-mp3");
  await expect(
    page.getByRole("heading", { name: "แปลงวิดีโอเป็นเสียง MP3", exact: true }),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/tools\/video-to-mp3$/,
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "วิดีโอและเสียง", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "แปลงเอกสาร", exact: true }),
  ).toBeVisible();
  await context.close();
});
test("leaving the conversion page cancels its server job and revokes download", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  let jobUrl = "",
    authorization = "";
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/media\/[0-9a-f-]+$/.test(new URL(r.url()).pathname)
    ) {
      jobUrl = r.url();
      authorization = r.headers()["authorization"];
    }
  });
  await page.goto("/tools/video-to-mp3");
  await expect(
    page.getByRole("button", { name: "เลือกวิดีโอ", exact: true }),
  ).toBeEnabled();
  await page
    .locator("[data-file]")
    .setInputFiles("tests/fixtures/audio-test.webm");
  await page.getByRole("button", { name: "แปลงเป็น MP3", exact: true }).click();
  await expect(page.locator("[data-result]")).toBeVisible({ timeout: 90000 });
  expect((await request.get(jobUrl)).status()).toBe(404);
  page.on("dialog", (d) => d.accept());
  await page.locator(".site-navigation .brand").click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(jobUrl, {
              headers: { Authorization: authorization },
            })
          ).json()
        ).state,
    )
    .toBe("cancelled");
  expect(
    (
      await request.get(jobUrl + "/result", {
        headers: { Authorization: authorization },
      })
    ).status(),
  ).toBe(409);
});

test("leaving during upload cancels work without a cancel button", async ({
  page,
  request,
}) => {
  let jobUrl = "",
    authorization = "";
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/media\/[0-9a-f-]+$/.test(new URL(r.url()).pathname)
    ) {
      jobUrl = r.url();
      authorization = r.headers()["authorization"];
    }
  });
  await page.route("**/api/media/*/chunks?*", async (route) => {
    await hold;
    await route.abort().catch(() => {});
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
    await expect(page.locator("[data-progress]")).toBeVisible();
    page.once("dialog", (d) => d.dismiss());
    await page.locator(".site-navigation .brand").click();
    await expect(page).toHaveURL(/video-to-mp3$/);
    page.once("dialog", (d) => d.accept());
    await page.locator(".site-navigation .brand").click();
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(jobUrl, {
                headers: { Authorization: authorization },
              })
            ).json()
          ).state,
      )
      .toBe("cancelled");
  } finally {
    release();
  }
});
