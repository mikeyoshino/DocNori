import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Template } from "../src/SabuySign.Web/Client/templates/model";

const id = "11111111-1111-4111-8111-111111111111";
function template(): Template {
  return {
    id,
    name: "สัญญาตัวอย่าง",
    version: 1,
    definition: {
      fields: [
        {
          id: "company",
          label: "ชื่อบริษัท",
          type: "text",
          required: true,
          defaultValue: "บริษัท ตัวอย่าง",
        },
      ],
      placements: [
        {
          id: "first",
          fieldId: "company",
          page: 0,
          x: 40,
          y: 60,
          width: 180,
          height: 40,
          size: 16,
          color: "#172433",
          align: "left",
          multiline: false,
        },
      ],
    },
  };
}
async function mockWorkspace(page: Page, initial: Template) {
  let saved = structuredClone(initial);
  const writes: { method: string; path: string; body: string | null }[] = [];
  const doc = await PDFDocument.create();
  doc
    .addPage([595, 842])
    .drawText("Original template content", { x: 30, y: 800, size: 12 });
  const pdf = Buffer.from(await doc.save());
  await page.route("**/api/account/me", (route) =>
    route.fulfill({
      json: {
        available: true,
        authenticated: true,
        verified: true,
        email: "owner@example.test",
        googleEnabled: false,
      },
    }),
  );
  await page.route("**/api/account/csrf", (route) =>
    route.fulfill({ json: { token: "test-csrf" } }),
  );
  await page.route("**/api/templates**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      writes.push({ method: request.method(), path, body: request.postData() });
      expect(request.headers()["x-csrf-token"]).toBe("test-csrf");
    }
    if (path.endsWith("/file"))
      return route.fulfill({ contentType: "application/pdf", body: pdf });
    if (path.endsWith("/limits"))
      return route.fulfill({
        json: {
          maxTemplates: 20,
          maxAccountBytes: 104857600,
          maxFileBytes: 26214400,
          maxPages: 100,
          maxFields: 100,
          maxPlacements: 300,
        },
      });
    if (request.method() === "PUT") {
      const input = request.postDataJSON();
      expect(input.version).toBe(saved.version);
      saved = { ...saved, ...input, version: saved.version + 1 };
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: path.endsWith(id) ? saved : [saved] });
  });
  return { writes, current: () => saved };
}

test("designer reuses a field, saves its default explicitly, and opens the saved fill form", async ({
  page,
}) => {
  const mock = await mockWorkspace(page, template());
  await page.goto(`/workspace/templates/${id}/edit`);
  await expect(page.locator(".template-paper canvas")).toBeVisible();
  await page
    .locator("[data-fields]")
    .getByRole("button", { name: "ชื่อบริษัท", exact: true })
    .click();
  await page.getByLabel("ค่าเริ่มต้น", { exact: true }).fill("บริษัท ทดสอบ");
  await page.getByLabel("ค่าเริ่มต้น", { exact: true }).blur();
  await page
    .getByRole("button", { name: "วางข้อมูลนี้อีกตำแหน่ง", exact: true })
    .click();
  await page.locator("[data-overlay]").click({ position: { x: 90, y: 220 } });
  await expect(page.locator(".template-box")).toHaveCount(2);
  expect(mock.writes).toEqual([]);
  await page.getByRole("button", { name: "บันทึกแม่แบบ", exact: true }).click();
  await expect(page.locator("[data-status]")).toContainText("บันทึกแม่แบบแล้ว");
  expect(mock.writes).toHaveLength(1);
  await page.screenshot({
    path: "artifacts/templates-designer-desktop.png",
    fullPage: true,
  });
  expect(mock.current().definition.fields).toHaveLength(1);
  expect(mock.current().definition.fields[0].defaultValue).toBe("บริษัท ทดสอบ");
  expect(mock.current().definition.placements).toHaveLength(2);
  expect(
    new Set(mock.current().definition.placements.map((p) => p.fieldId)).size,
  ).toBe(1);
  await page.getByRole("link", { name: "กรอกข้อมูล", exact: true }).click();
  await expect(page.getByLabel("ชื่อบริษัท", { exact: true })).toHaveValue(
    "บริษัท ทดสอบ",
  );
  await expect(
    page.getByRole("button", { name: "ดาวน์โหลด PDF", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  expect(mock.writes).toHaveLength(1);
});

test("fill blocks overflow at every reused placement and downloads real Thai text locally", async ({
  page,
}) => {
  const data = template();
  data.definition.placements.push({
    ...data.definition.placements[0],
    id: "second",
    y: 160,
    width: 100,
  });
  const mock = await mockWorkspace(page, data);
  const unexpectedWrites: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") unexpectedWrites.push(r.url());
  });
  await page.goto(`/workspace/templates/${id}/fill`);
  const field = page.getByLabel("ชื่อบริษัท", { exact: true });
  const download = page.getByRole("button", {
    name: "ดาวน์โหลด PDF",
    exact: true,
  });
  await expect(field).toHaveValue("บริษัท ตัวอย่าง");
  await field.fill("ข้อความยาวมากสำหรับช่องเอกสาร".repeat(20));
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".template-field-error")).toContainText(
    "ข้อความยาวเกินช่อง",
  );
  await expect(page.locator(".template-box.is-overflow")).toHaveCount(2);
  await expect(download).toBeDisabled();
  await field.fill("น้ำ กุ้ง ปู่");
  await expect(download).toBeEnabled({ timeout: 30000 });
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await page.screenshot({
    path: "artifacts/templates-fill-desktop.png",
    fullPage: true,
  });
  const result = page.waitForEvent("download");
  await download.click();
  const bytes = await readFile((await (await result).path())!);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.isEncrypted).toBe(false);
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  try {
    const content = await (
      await (await task.promise).getPage(1)
    ).getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(text).toContain("Original template content");
    expect(text.replace(/\s/g, "").split("น้ำกุ้งปู่")).toHaveLength(3);
  } finally {
    await task.destroy();
  }
  await page
    .getByRole("button", { name: "เริ่มฉบับใหม่", exact: true })
    .click();
  await expect(field).toHaveValue("บริษัท ตัวอย่าง");
  expect(mock.writes).toEqual([]);
  expect(unexpectedWrites).toEqual([]);
  expect(
    await page.evaluate(() => ({
      // Blazor records only a runtime resource hash; document values must not be stored.
      local: Object.keys(localStorage).filter(
        (key) => !key.startsWith("blazor-resource-hash:"),
      ).length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
});

test("mobile fill switches between form and PDF preview without losing local values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkspace(page, template());
  await page.goto(`/workspace/templates/${id}/fill`);
  const field = page.getByLabel("ชื่อบริษัท", { exact: true });
  await expect(field).toHaveValue("บริษัท ตัวอย่าง");
  await field.fill("บริษัท ทดสอบ");
  await expect(
    page.getByRole("button", { name: "ดาวน์โหลด PDF", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.screenshot({
    path: "artifacts/templates-fill-mobile-form.png",
    fullPage: true,
  });
  await page
    .locator(".template-mobile-tabs")
    .getByRole("button", { name: "ดูตัวอย่าง", exact: true })
    .click();
  await expect(page.locator(".template-stage")).toBeVisible();
  await expect(field).not.toBeVisible();
  await page.screenshot({
    path: "artifacts/templates-fill-mobile-preview.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page
    .locator(".template-mobile-tabs")
    .getByRole("button", { name: "กรอกข้อมูล", exact: true })
    .click();
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("บริษัท ทดสอบ");
});

test("editing while save is in flight remains dirty and the next save uses the new version", async ({
  page,
}) => {
  await mockWorkspace(page, template());
  let release: (() => void) | undefined;
  let requestSeen: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    requestSeen = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const updates: any[] = [];
  await page.route(`**/api/templates/${id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    updates.push(body);
    if (updates.length === 1) {
      requestSeen!();
      await held;
    }
    await route.fulfill({ json: { id, ...body, version: body.version + 1 } });
  });
  await page.goto(`/workspace/templates/${id}/edit`);
  const name = page.getByLabel("ชื่อแม่แบบ", { exact: true });
  await name.fill("First save");
  await page.getByRole("button", { name: "บันทึกแม่แบบ", exact: true }).click();
  await received;
  await name.fill("New unsaved edit");
  release!();
  await expect(page.locator("[data-status]")).toContainText(
    "มีการแก้ไขใหม่ที่ยังไม่ได้บันทึก",
  );
  expect(updates[0].name).toBe("First save");
  await page.getByRole("button", { name: "บันทึกแม่แบบ", exact: true }).click();
  await expect(page.locator("[data-status]")).toHaveText("บันทึกแม่แบบแล้ว");
  expect(updates[1]).toMatchObject({ name: "New unsaved edit", version: 2 });
});

test("a queued old export completion cannot enable download after a new value", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const pending: (() => Promise<void>)[] = [];
    (window as any).__templateExports = pending;
    // Keep the new-value debounce pending while delivering the old completion deterministically.
    const nativeTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: any[]
    ) =>
      nativeTimeout(
        handler,
        delay === 350 ? 5000 : delay,
        ...args,
      )) as typeof window.setTimeout;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("export.worker")) return;
        Object.defineProperty(this, "onmessage", {
          set: (handler: (event: MessageEvent) => Promise<void>) => {
            this.addEventListener("message", (event) => {
              pending.push(() => handler(event));
            });
          },
        });
      }
    };
  });
  await mockWorkspace(page, template());
  await page.goto(`/workspace/templates/${id}/fill`);
  await page.waitForFunction(
    () => (window as any).__templateExports.length === 1,
  );
  const stillDisabled = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="ชื่อบริษัท"]',
    )!;
    input.value = "New latest value";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await (window as any).__templateExports.shift()();
    return [
      ...document.querySelectorAll<HTMLButtonElement>("[data-actions] button"),
    ].find((b) => b.textContent === "ดาวน์โหลด PDF")!.disabled;
  });
  expect(stillDisabled).toBe(true);
  await expect(
    page.getByRole("button", { name: "ดาวน์โหลด PDF", exact: true }),
  ).toBeDisabled();
});

test("workspace uploads a real multipart PDF, opens its designer, duplicates and confirms deletion", async ({
  page,
}) => {
  await mockWorkspace(page, template());
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawText("Uploaded source", { x: 30, y: 800 });
  const pdf = Buffer.from(await doc.save());
  const entries: Template[] = [];
  const mutations: string[] = [];
  const copyId = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/templates**", async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname;
    if (r.method() !== "GET") {
      expect(r.headers()["x-csrf-token"]).toBe("test-csrf");
      mutations.push(r.method() + " " + path);
    }
    if (path === "/api/templates" && r.method() === "GET")
      return route.fulfill({ json: entries });
    if (path === "/api/templates" && r.method() === "POST") {
      expect(r.headers()["content-type"]).toContain(
        "multipart/form-data; boundary=",
      );
      const form = await new Response(new Uint8Array(r.postDataBuffer()!), {
        headers: { "Content-Type": r.headers()["content-type"] },
      }).formData();
      expect([...form.keys()].sort()).toEqual(["file", "name"]);
      expect(form.get("name")).toBe("แม่แบบอัปโหลด");
      const file = form.get("file") as File;
      expect(file.name).toBe("template.pdf");
      expect(file.type).toBe("application/pdf");
      expect(Buffer.from(await file.arrayBuffer())).toEqual(pdf);
      entries.push({
        id,
        name: String(form.get("name")),
        version: 1,
        definition: { fields: [], placements: [] },
      });
      return route.fulfill({ status: 201, json: entries[0] });
    }
    if (path === `/api/templates/${id}/duplicate`) {
      expect(r.postDataJSON()).toEqual({});
      const copy = {
        ...structuredClone(entries[0]),
        id: copyId,
        name: "แม่แบบอัปโหลด (สำเนา)",
      };
      entries.unshift(copy);
      return route.fulfill({ status: 201, json: copy });
    }
    if (path === `/api/templates/${copyId}` && r.method() === "DELETE") {
      entries.splice(
        entries.findIndex((t) => t.id === copyId),
        1,
      );
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/file"))
      return route.fulfill({ contentType: "application/pdf", body: pdf });
    if (path === `/api/templates/${id}`)
      return route.fulfill({ json: entries.find((t) => t.id === id) });
    return route.fallback();
  });
  await page.goto("/workspace/templates");
  await expect(
    page.getByRole("heading", { name: "สร้างแม่แบบแรกของคุณ" }),
  ).toBeVisible();
  await page
    .locator(".workspace-heading")
    .getByRole("link", { name: "สร้างแม่แบบ" })
    .click();
  await expect(page.locator(".template-privacy")).toContainText(
    "ไฟล์แม่แบบจะถูกเก็บในบัญชี",
  );
  await page.getByLabel("ชื่อแม่แบบ", { exact: true }).fill("แม่แบบอัปโหลด");
  await page.getByLabel("เลือกไฟล์ PDF", { exact: true }).setInputFiles({
    name: "private-original.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await page
    .getByRole("button", { name: "อัปโหลดและกำหนดช่อง", exact: true })
    .click();
  await expect(page).toHaveURL(`/workspace/templates/${id}/edit`);
  await expect(page.getByLabel("ชื่อแม่แบบ", { exact: true })).toHaveValue(
    "แม่แบบอัปโหลด",
  );
  await expect(page.locator("[data-fields]")).toContainText("เพิ่มช่องข้อมูล");
  await page.getByRole("link", { name: "แม่แบบของฉัน" }).click();
  await expect(page.locator(".template-card")).toHaveCount(1);
  await page.getByRole("button", { name: "ทำสำเนา", exact: true }).click();
  await expect(page.locator(".template-card")).toHaveCount(2);
  const copyCard = page.locator(".template-card").filter({
    has: page.getByRole("heading", {
      name: "แม่แบบอัปโหลด (สำเนา)",
      exact: true,
    }),
  });
  await copyCard.getByRole("button", { name: "ลบ", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "ลบแม่แบบนี้?",
    exact: true,
  });
  await expect(dialog).toContainText("แม่แบบอัปโหลด (สำเนา)");
  await dialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  expect(mutations.filter((m) => m.startsWith("DELETE"))).toEqual([]);
  await expect(page.locator(".template-card")).toHaveCount(2);
  await copyCard.getByRole("button", { name: "ลบ", exact: true }).click();
  await dialog.getByRole("button", { name: "ยืนยัน", exact: true }).click();
  await expect(page.locator(".template-card")).toHaveCount(1);
  await expect(page.locator(".template-card h2")).toHaveText("แม่แบบอัปโหลด");
  expect(mutations).toEqual([
    "POST /api/templates",
    `POST /api/templates/${id}/duplicate`,
    `DELETE /api/templates/${copyId}`,
  ]);
});

test("account login shows Google unavailable and submits credentials with CSRF", async ({
  page,
}) => {
  await mockWorkspace(page, template());
  let authenticated = false;
  await page.route("**/api/account/me", (route) =>
    route.fulfill({
      json: {
        available: true,
        authenticated,
        verified: authenticated,
        email: authenticated ? "owner@example.test" : null,
        googleEnabled: false,
        emailEnabled: true,
      },
    }),
  );
  await page.route("**/api/account/login", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("test-csrf");
    expect(route.request().postDataJSON()).toEqual({
      email: "owner@example.test",
      password: "Only-a-browser-test-123!",
    });
    authenticated = true;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto("/account/login?returnUrl=/workspace/templates");
  await expect(page.locator(".account-google")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.locator(".account-google")).not.toHaveAttribute(
    "href",
    /.+/,
  );
  await expect(
    page.getByText("Google ยังไม่เปิดใช้งาน", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("อีเมล", { exact: true }).fill("owner@example.test");
  await page
    .getByLabel("รหัสผ่าน", { exact: true })
    .fill("Only-a-browser-test-123!");
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL("/workspace/templates");
  await expect(page.locator(".template-card")).toHaveCount(1);
});

test("unconfigured account and email registration show availability without offering a broken form", async ({
  page,
}) => {
  let available = false;
  await page.route("**/api/account/me", (route) =>
    route.fulfill({
      json: {
        available,
        authenticated: false,
        verified: false,
        googleEnabled: false,
        emailEnabled: false,
      },
    }),
  );
  await page.goto("/account/login");
  await expect(page.locator(".account-card [data-message]")).toHaveText(
    "ระบบสมาชิกยังไม่พร้อมใช้งาน กรุณากลับมาอีกครั้ง",
  );
  await expect(page.locator(".account-card form")).toHaveCount(0);
  available = true;
  await page.goto("/account/register");
  await expect(page.locator(".account-card [data-message]")).toHaveText(
    "การสมัครและกู้คืนด้วยอีเมลยังไม่เปิดใช้งาน",
  );
  await expect(page.locator(".account-card form")).toHaveCount(0);
});
