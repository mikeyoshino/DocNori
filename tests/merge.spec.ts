import { test, expect } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";

test("local merge supports ordering, removal, errors and a valid download", async ({
  page,
}) => {
  const pdf = async (width: number) => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([width, 500]);
    p.drawText(`Document ${width}`, { x: 20, y: 420, size: 18 });
    p.drawRectangle({
      x: 20,
      y: 100,
      width: 100,
      height: 100,
      color: rgb(0.1, 0.4, 0.8),
    });
    return Buffer.from(await doc.save());
  };
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") posts.push(r.url());
  });
  await page.goto("/tools/merg");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const input = page.locator("input[type=file]");
  const downloadButton = page.getByRole("button", {
    name: "รวมและดาวน์โหลด PDF",
  });
  await expect(downloadButton).toBeHidden();
  await input.setInputFiles([
    { name: "first.pdf", mimeType: "application/pdf", buffer: await pdf(300) },
    { name: "second.pdf", mimeType: "application/pdf", buffer: await pdf(600) },
    {
      name: "broken.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("broken"),
    },
  ]);
  await expect(page.locator(".merge-list li")).toHaveCount(2);
  await expect(page.getByRole("alert")).toContainText("broken.pdf");
  await page
    .getByRole("button", { name: "เลื่อนขึ้น second.pdf", exact: true })
    .click();
  await expect(page.locator(".merge-list li").first()).toContainText(
    "second.pdf",
  );
  await expect(page.locator(".merge-cover canvas")).toHaveCount(2);
  await page
    .getByRole("button", { name: "เรียงชื่อไฟล์ ก–ฮ / A–Z", exact: true })
    .click();
  await expect(page.locator(".merge-list li").first()).toContainText(
    "first.pdf",
  );
  await page
    .locator(".merge-list li")
    .first()
    .dragTo(page.locator(".merge-list li").last());
  await expect(page.locator(".merge-list li").first()).toContainText(
    "second.pdf",
  );
  // Pause real CSS transitions halfway to verify the menu animates, not jumps.
  const animation = await page
    .locator("[data-file-picker]")
    .evaluate(async (element) => {
      const menu = element.querySelector<HTMLElement>("[data-picker-sources]")!;
      getComputedStyle(menu).height;
      element.dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "mouse" }),
      );
      await new Promise(requestAnimationFrame);
      const transitions = menu.getAnimations({ subtree: true });
      for (const transition of transitions) {
        transition.pause();
        transition.currentTime = 100;
      }
      const height = menu.getBoundingClientRect().height;
      for (const transition of transitions) transition.finish();
      return { count: transitions.length, height };
    });
  expect(animation.count).toBeGreaterThan(0);
  expect(animation.height).toBeGreaterThan(0);
  expect(animation.height).toBeLessThan(153);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "เพิ่มไฟล์", exact: true }).hover();
  await expect(
    page.getByRole("button", { name: "เพิ่มไฟล์", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", {
      name: "Google Drive ยังไม่เชื่อมต่อ",
      exact: true,
    }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.screenshot({
    path: "artifacts/merge-add-options.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "เลือกไฟล์จากเครื่อง", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "third.pdf",
    mimeType: "application/pdf",
    buffer: await pdf(400),
  });
  await expect(page.locator(".merge-list li")).toHaveCount(3);
  await page.getByRole("button", { name: "ลบ third.pdf", exact: true }).click();
  const pending = page.waitForEvent("download");
  await downloadButton.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("merged.pdf");
  const result = await PDFDocument.load(
    await readFile((await download.path())!),
  );
  expect(result.getPages().map((p) => p.getWidth())).toEqual([600, 300]);
  expect(posts).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/merge-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "เพิ่มไฟล์", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์จากเครื่อง", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator("[data-picker-sources]")
      .evaluate((e) => getComputedStyle(e).transitionDuration),
  ).toBe("0s");

  await expect(
    page.getByRole("button", { name: "เลือกไฟล์จากเครื่อง", exact: true }),
  ).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/merge-mobile.png", fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "ลบ first.pdf", exact: true }).click();
  await expect(downloadButton).toBeDisabled();
  await page.getByRole("button", { name: "ล้างรายการ", exact: true }).click();
  await expect(page.locator(".merge-list li")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("ยังไม่ได้เลือกไฟล์");
});
