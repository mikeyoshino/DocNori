import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { readFile } from "node:fs/promises";
async function openPdf(page: Page) {
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "private.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator("#page-canvas")).toBeVisible();
}
async function draw(page: Page, id: string) {
  const box = (await page.locator(id).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.55);
  await page.mouse.down();
  for (const [x, y] of [
    [0.22, 0.3],
    [0.3, 0.7],
    [0.4, 0.4],
    [0.5, 0.6],
    [0.65, 0.25],
    [0.75, 0.5],
  ])
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, {
      steps: 8,
    });
  await page.mouse.up();
}
test("desktop save, reusable placement, proportional resize, undo and vector PDF download", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() !== "GET" &&
      new URL(r.url()).origin === new URL(page.url()).origin
    )
      writes.push(r.url());
  });
  await openPdf(page);
  await page
    .locator(".signature-library-panel")
    .getByRole("button", { name: "เซ็นเอกสาร", exact: true })
    .click();
  await page.locator("#sign-only-me").click();
  await page
    .locator("#signature-source")
    .getByRole("button", { name: "สร้างลายเซ็น", exact: true })
    .click();
  await expect(page.locator("#desktop-save")).toBeDisabled();
  await draw(page, "#desktop-pad");
  await page.locator("#desktop-save").click();
  const asset = page.getByRole("button", { name: "วางลายเซ็น 1", exact: true });
  await expect(asset).toBeVisible();
  await asset.click();
  await page.locator("#page-surface").click({ position: { x: 140, y: 200 } });
  await expect(page.locator(".signature-object")).toHaveCount(1);
  const ink = page.locator(".signature-object img");
  const start = (await ink.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 + 45,
    start.y + start.height / 2 + 30,
    { steps: 8 },
  );
  await page.mouse.up();
  const moved = (await ink.boundingBox())!;
  expect(moved.x - start.x).toBeCloseTo(45, 0);
  expect(moved.y - start.y).toBeCloseTo(30, 0);
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  expect((await ink.boundingBox())!.x).toBeCloseTo(start.x, 0);
  await page.getByRole("button", { name: "ทำซ้ำ", exact: true }).click();
  await ink.click();
  const before = (await page.locator(".signature-object").boundingBox())!;
  await page.getByLabel("ความกว้างลายเซ็น").fill("150");
  await page.getByLabel("ความกว้างลายเซ็น").blur();
  const after = (await page.locator(".signature-object").boundingBox())!;
  expect(after.width / after.height).toBeCloseTo(
    before.width / before.height,
    1,
  );
  await asset.dragTo(page.locator("#page-surface"), {
    targetPosition: { x: 180, y: 320 },
  });
  await expect(page.locator(".signature-object")).toHaveCount(2);
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(page.locator(".signature-object")).toHaveCount(1);
  await page.getByRole("button", { name: "ทำซ้ำ", exact: true }).click();
  await expect(page.locator(".signature-object")).toHaveCount(2);
  await page
    .getByRole("button", { name: "ดูตัวอย่าง PDF", exact: true })
    .click();
  await expect(page.locator("#preview-dialog")).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลดไฟล์นี้", exact: true })
    .click();
  const pdf = await PDFDocument.load(
    await readFile((await (await downloading).path())!),
  );
  const streams = pdf.context
    .enumerateIndirectObjects()
    .filter(([, v]) => v instanceof PDFRawStream)
    .map(([, v]) => {
      try {
        return Buffer.from(
          decodePDFRawStream(v as PDFRawStream).decode(),
        ).toString();
      } catch {
        return "";
      }
    })
    .join("\n");
  expect(streams.match(/\nf\n/g)?.length).toBe(2);
  expect(streams).toMatch(/ c\n/);
  expect(writes).toEqual([]);
  await page.screenshot({ path: "artifacts/signature-preview.png" });
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await expect(page.locator("#page-canvas")).toBeHidden();
});
test("QR phone saves encrypted ink to desktop once; PDF stays local; cancellation revokes link", async ({
  page,
  browser,
}) => {
  test.skip(!process.env.APP_URL, "Phone relay runs with Docker Compose");
  await openPdf(page);
  await page
    .locator(".signature-library-panel")
    .getByRole("button", { name: "เซ็นเอกสาร", exact: true })
    .click();
  await page.locator("#sign-only-me").click();
  await page
    .getByRole("button", { name: "ใช้มือถือเซ็น", exact: true })
    .click();
  const link = page.locator("#pair-link");
  await expect(link).toBeVisible();
  const url = (await link.getAttribute("href"))!;
  await page.screenshot({ path: "artifacts/signature-qr.png" });
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await phoneContext.newPage();
  const payloads: Buffer[] = [];
  phone.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/pairing\/[^/]+\/signature$/.test(new URL(r.url()).pathname)
    )
      payloads.push(r.postDataBuffer()!);
  });
  await phone.goto(url);
  await expect(phone.locator("#mobile-status")).toHaveText("พร้อมรับลายเซ็น");
  expect(new URL(phone.url()).hash).toBe("");
  await expect(phone.locator("#mobile-save")).toBeDisabled();
  await draw(phone, "#mobile-pad");
  await phone.screenshot({ path: "artifacts/signature-mobile.png" });
  await phone.locator("#mobile-save").click();
  await expect(phone.locator("#mobile-status")).toContainText("ส่งลายเซ็นแล้ว");
  await expect(page.locator("#signature-phone")).not.toBeVisible();
  await expect(page.locator(".signature-thumbnail")).toHaveCount(1);
  expect(payloads).toHaveLength(1);
  expect(payloads[0].toString()).not.toContain("strokes");
  expect(payloads[0].toString()).not.toContain("%PDF");
  expect(
    await phone.evaluate(() => ({
      local: Object.keys(localStorage).filter(
        (key) => key !== "blazor-resource-hash:SabuySign.Web",
      ).length,
      runtimeHashOnly: /^sha256-[A-Za-z0-9+/]{43}=$/.test(
        localStorage.getItem("blazor-resource-hash:SabuySign.Web") ?? "",
      ),
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0, runtimeHashOnly: true });
  await phone.reload();
  await expect(phone.locator("#mobile-status")).toContainText("ลิงก์ไม่ครบ");
  await page
    .locator(".signature-library-panel")
    .getByRole("button", { name: "เซ็นเอกสาร", exact: true })
    .click();
  await page.locator("#sign-only-me").click();
  await page
    .getByRole("button", { name: "ใช้มือถือเซ็น", exact: true })
    .click();
  await expect(link).toBeVisible();
  const old = (await link.getAttribute("href"))!;
  const cancelled = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" && r.url().includes("/api/pairing/"),
  );
  await page.getByLabel("ยกเลิกการเชื่อมต่อมือถือ").click();
  expect((await cancelled).status()).toBe(204);
  await phone.goto(old);
  await expect(phone.locator("#mobile-status")).toContainText("ลิงก์หมดอายุ");
  await phoneContext.close();
});

test("late acknowledgement cannot cancel a replacement QR", async ({
  page,
}) => {
  test.skip(!process.env.APP_URL, "Phone relay runs with Docker Compose");
  const { encryptSignature } =
    await import("../src/SabuySign.Web/Client/signatures/crypto.ts");
  await openPdf(page);
  await page
    .locator(".signature-library-panel")
    .getByRole("button", { name: "เซ็นเอกสาร", exact: true })
    .click();
  await page.locator("#sign-only-me").click();
  await page
    .getByRole("button", { name: "ใช้มือถือเซ็น", exact: true })
    .click();
  const link = page.locator("#pair-link");
  await expect(link).toBeVisible();
  const url = (await link.getAttribute("href"))!;
  const [, id, key, writer] = new URL(url).hash.slice(1).split(".");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let received!: () => void;
  const pending = new Promise<void>((resolve) => (received = resolve));
  await page.route(`**/api/pairing/${id}/ack`, async (route) => {
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  const data = await encryptSignature(
    {
      width: 100,
      height: 40,
      strokes: [
        [
          [8, 8],
          [90, 30],
        ],
      ],
    },
    key,
    id,
  );
  expect(
    (
      await page.request.post(`/api/pairing/${id}/signature`, {
        headers: {
          Authorization: `Bearer ${writer}`,
          "Content-Type": "application/octet-stream",
        },
        data: Buffer.from(data),
      })
    ).status(),
  ).toBe(202);
  await pending;
  await page.locator("#pair-retry").click();
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute("href", url);
  const next = (await link.getAttribute("href"))!;
  release();
  // Waiting for the next GET proves the new poll loop is still active after ACK A returned.
  const nextId = new URL(next).hash.slice(1).split(".")[1];
  await page.waitForRequest((r) =>
    r.url().endsWith(`/api/pairing/${nextId}/signature`),
  );
  await expect(page.locator("#signature-phone")).toBeVisible();
  await expect(link).toHaveAttribute("href", next);
  await page.getByLabel("ยกเลิกการเชื่อมต่อมือถือ").click();
});
