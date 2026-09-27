import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const older = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "หนังสือรับรอง",
  version: 2,
  updatedAt: "2026-09-01T08:00:00Z",
};
const newer = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "สัญญาจ้างพนักงานสำหรับฝ่ายปฏิบัติการและพนักงานประจำสำนักงานใหญ่",
  version: 4,
  updatedAt: "2026-09-28T08:00:00Z",
};
async function mock(page: Page) {
  await page.route("**/api/account/me", (route) =>
    route.fulfill({
      json: {
        available: true,
        authenticated: true,
        verified: true,
        googleEnabled: true,
        googleLinked: true,
      },
    }),
  );
  await page.route("**/api/account/csrf", (route) =>
    route.fulfill({ json: { token: "test-csrf" } }),
  );
  await page.route("**/api/templates", (route) =>
    route.fulfill({ json: [older, newer] }),
  );
  await page.route("**/api/templates/limits", (route) =>
    route.fulfill({
      json: {
        maxFileBytes: 26214400,
        maxPages: 100,
        maxTemplates: 20,
        maxAccountBytes: 104857600,
      },
    }),
  );
}

test("library sorts by edit date, preserves search, and aligns actions for long titles", async ({
  page,
}) => {
  await mock(page);
  await page.route("**/api/templates/*/file", (route) =>
    route.fulfill({ status: 500 }),
  );
  await page.goto("/workspace/templates");
  const cards = page.locator(".template-card");
  await expect(cards.first().locator("h2")).toHaveText(newer.name);
  await expect(cards.first().locator("h2 a")).toHaveAttribute(
    "href",
    `/workspace/templates/${newer.id}/fill`,
  );
  await expect(
    cards.first().locator(".template-card-thumbnail"),
  ).toHaveAttribute("href", `/workspace/templates/${newer.id}/fill`);
  await expect(cards.first()).toContainText("แก้ไขล่าสุด");
  const actions = await cards
    .locator(":scope > .button")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().top));
  expect(Math.abs(actions[0] - actions[1])).toBeLessThan(2);
  await expect(page.locator(".template-library-tools select")).toHaveCount(0);
  await page.getByRole("button", { name: "เรียงตาม", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "เรียงตาม", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "เรียงตาม", exact: true }),
  ).toHaveText("แก้ไขเก่าสุด⌄");
  await expect(cards.first().locator("h2")).toHaveText(older.name);
  await page.getByLabel("ค้นหาแม่แบบ").fill("สัญญา");
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "เรียงตาม", exact: true }).click();
  await page.getByRole("option", { name: "แก้ไขล่าสุด", exact: true }).click();
  await expect(cards).toHaveCount(1);
});

test("thumbnail loading stays local and preserves PDF aspect ratio", async ({
  page,
}) => {
  await mock(page);
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  const bytes = Buffer.from(await pdf.save());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/templates/*/file", async (route) => {
    await gate;
    await route.fulfill({ contentType: "application/pdf", body: bytes });
  });
  await page.goto("/workspace/templates");
  await expect(page.locator(".template-card").first()).toBeVisible();
  await expect(page.locator(".template-card-icon").first()).toHaveAttribute(
    "aria-busy",
    "true",
  );
  const placeholder = page.locator(".template-thumbnail-placeholder").first();
  await expect(placeholder).toHaveAttribute("aria-label", "กำลังโหลดตัวอย่าง");
  await expect(placeholder).toHaveText("");
  await expect(page.locator(".app-activity")).not.toBeVisible();
  release();
  const canvas = page.locator(".template-card-icon canvas").first();
  await expect(canvas).toBeVisible();
  await expect(page.locator(".template-card").first()).toContainText("2 หน้า");
  const size = await canvas.boundingBox();
  expect(size!.width / size!.height).toBeCloseTo(595 / 842, 2);
});

test("upload accepts dropped PDF, suggests a name, and preserves a custom name", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/workspace/templates/new");
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["%PDF-1.7"], "หนังสือรับรอง.pdf", { type: "application/pdf" }),
    );
    return data;
  });
  await page
    .locator("[data-dropzone]")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByLabel("ชื่อแม่แบบ")).toHaveValue("หนังสือรับรอง");
  await expect(page.locator("[data-file-name]")).toHaveText(
    "หนังสือรับรอง.pdf",
  );
  await page.getByLabel("ชื่อแม่แบบ").fill("ชื่อที่ตั้งเอง");
  await page.locator('input[type="file"]').setInputFiles({
    name: "replacement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7"),
  });
  await expect(page.getByLabel("ชื่อแม่แบบ")).toHaveValue("ชื่อที่ตั้งเอง");
  await expect(page.getByRole("button", { name: "เปลี่ยนไฟล์" })).toBeVisible();
});

test("upload rejects wrong and oversized files before submit and allows recovery", async ({
  page,
}) => {
  await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/templates/new");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a pdf"),
  });
  await expect(page.locator("[data-message]")).toContainText("PDF");
  await expect(
    page.getByRole("button", { name: "อัปโหลดและกำหนดช่อง" }),
  ).toBeDisabled();
  await input.setInputFiles({
    name: "large.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(26214401),
  });
  await expect(page.locator("[data-message]")).toContainText("25 MB");
  await input.setInputFiles({
    name: "valid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7"),
  });
  await expect(page.locator("[data-message]")).toBeEmpty();
  await expect(
    page.getByRole("button", { name: "อัปโหลดและกำหนดช่อง" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const next of [
  `/workspace/templates/${newer.id}/fill?view=preview`,
  "/workspace/../../evil",
  "//example.com/workspace/templates",
]) {
  test(`login carries a safe return URL: ${next}`, async ({ page }) => {
    await mock(page);
    await page.goto(`/account/login?returnUrl=${encodeURIComponent(next)}`);
    const safe = next.includes("/fill") ? next : "/workspace/templates";
    const google = new URL(
      (await page
        .getByRole("link", { name: "เข้าสู่ระบบด้วย Google" })
        .getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(google.searchParams.get("returnUrl")).toBe(safe);
    await expect(
      page.getByRole("link", { name: "สมัครสมาชิก", exact: true }),
    ).toHaveAttribute(
      "href",
      `/account/register?returnUrl=${encodeURIComponent(safe)}`,
    );
  });
}

test("keyboard file selection uploads the selected PDF and default name", async ({
  page,
}) => {
  await mock(page);
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const bytes = Buffer.from(await pdf.save());
  let uploaded = "";
  await page.route("**/api/templates", async (route) => {
    if (route.request().method() === "POST") {
      uploaded = route.request().postDataBuffer()!.toString("latin1");
      return route.fulfill({ json: { id: newer.id } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/workspace/templates/new");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "เลือกไฟล์จากเครื่อง" }).focus();
  await page.keyboard.press("Enter");
  await (
    await chooser
  ).setFiles({
    name: "employment.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "อัปโหลดและกำหนดช่อง" }).click();
  await page.waitForURL(`**/workspace/templates/${newer.id}/edit`);
  expect(uploaded).toContain('name="name"');
  expect(uploaded).toContain("employment");
  expect(uploaded).toContain("%PDF-");
});

test("email login returns to the original workspace URL", async ({ page }) => {
  await mock(page);
  await page.route("**/api/account/login", (route) =>
    route.fulfill({ json: {} }),
  );
  const next = "/workspace/templates/new?from=login";
  await page.goto(`/account/login?returnUrl=${encodeURIComponent(next)}`);
  await page.getByLabel("อีเมล", { exact: true }).fill("owner@example.test");
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill("example-password");
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await page.waitForURL(`**${next}`);
  await expect(
    page.getByRole("heading", { name: "สร้างแม่แบบเอกสาร" }),
  ).toBeVisible();
});

test("landing labels the illustrative example and explains stored data", async ({
  page,
}) => {
  await page.goto("/templates");
  await expect(
    page.getByText("ภาพประกอบขั้นตอน · ข้อมูลสมมติสำหรับสาธิต"),
  ).toBeVisible();
  await expect(page.locator(".template-demo-stages article")).toHaveCount(3);
  await expect(page.locator(".template-privacy")).toContainText(
    "เราเก็บไฟล์แม่แบบและการตั้งค่าช่อง",
  );
  await expect(page.locator("main").getByRole("link")).toHaveCount(1);
});
