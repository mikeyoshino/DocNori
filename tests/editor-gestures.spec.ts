import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test("pinch zoom is scoped to the PDF and new text keeps its size", async ({
  page,
}) => {
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "gesture.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  const surface = page.locator("#page-surface");
  await expect(surface).toBeVisible();
  await page.getByLabel("ระดับซูม", { exact: true }).selectOption("1");
  const initial = await surface.boundingBox();
  const pinch = await surface.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
      clientX: rect.left + 200,
      clientY: rect.top + 200,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(pinch).toBe(true);
  await expect
    .poll(async () => (await surface.boundingBox())!.width)
    .toBeGreaterThan(initial!.width);
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  await expect
    .poll(async () =>
      Number(await page.getByLabel("ระดับซูม", { exact: true }).inputValue()),
    )
    .toBeGreaterThan(1);
  const beforeSafari = (await surface.boundingBox())!.width;
  expect(
    await surface.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const events = ["gesturestart", "gesturechange", "gestureend"].map(
        (name, index) => {
          const event = new Event(name, { bubbles: true, cancelable: true });
          Object.assign(event, {
            scale: index === 0 ? 1 : 0.8,
            clientX: rect.left + 200,
            clientY: rect.top + 200,
          });
          el.dispatchEvent(event);
          return event.defaultPrevented;
        },
      );
      return events;
    }),
  ).toEqual([true, true, true]);
  await expect
    .poll(async () => (await surface.boundingBox())!.width)
    .toBeLessThan(beforeSafari);

  const ordinary = await surface.evaluate((el) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 50,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(ordinary).toBe(false);
  expect(
    await page.locator("body").evaluate((el) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -50,
      });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await page.getByLabel("ระดับซูม", { exact: true }).selectOption("1");
  await page
    .getByRole("button", { name: "เพิ่มข้อความ", exact: true })
    .first()
    .click();
  await surface.click({ position: { x: 100, y: 150 } });
  await page.getByLabel("ขนาดตัวอักษร", { exact: true }).fill("28");
  await page.getByLabel("ขนาดตัวอักษร", { exact: true }).blur();
  await page
    .getByRole("button", { name: "เพิ่มข้อความ", exact: true })
    .first()
    .click();
  await surface.click({ position: { x: 100, y: 300 } });
  await expect(page.getByLabel("ขนาดตัวอักษร", { exact: true })).toHaveValue(
    "28",
  );
});
