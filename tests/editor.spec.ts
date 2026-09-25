import { chooseDropdown } from "./helpers/dropdown";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
test("local-only fill, undo, preview and download survives export; reload clears session", async ({
  page,
}) => {
  const outgoing: string[] = [];
  const requests: { url: string; body: string | null }[] = [];
  page.on("request", (r) => {
    requests.push({ url: r.url(), body: r.postData() });
    if (r.method() !== "GET" && new URL(r.url()).hostname === "127.0.0.1")
      outgoing.push(r.url());
  });
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", {
      name: "กรอกข้อความภาษาไทยและเซ็น PDF ออนไลน์",
      exact: true,
    }),
  ).toBeVisible();
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "แบบฟอร์ม.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator("#page-canvas")).toBeVisible();
  await page
    .getByRole("button", { name: "เพิ่มข้อความ", exact: true })
    .first()
    .click();
  await page.locator("#page-surface").click({ position: { x: 100, y: 180 } });
  await page.getByLabel("ข้อความที่เลือก").fill("ชื่อผู้สมัคร น้ำ กุ้ง ปู่");
  await page.getByLabel("ข้อความที่เลือก").blur();
  await expect(page.locator(".text-object textarea")).toHaveValue(
    "ชื่อผู้สมัคร น้ำ กุ้ง ปู่",
  );
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(page.locator(".text-object textarea")).toHaveValue("ข้อความ");
  await page.getByRole("button", { name: "ทำซ้ำ", exact: true }).click();
  await page
    .getByRole("button", { name: "ดูตัวอย่าง PDF", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลดไฟล์นี้", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain("-filled.pdf");
  expect(outgoing).toEqual([]);
  for (const request of requests) {
    const url = new URL(request.url);
    expect(decodeURIComponent(url.href)).not.toMatch(/แบบฟอร์ม|ชื่อผู้สมัคร/);
    expect(request.body ?? "").not.toMatch(/แบบฟอร์ม|ชื่อผู้สมัคร/);
    if (url.hostname === "127.0.0.1") expect(url.search).toBe("");
  }
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: Object.keys(localStorage).filter(
        (key) => key !== "blazor-resource-hash:SabuySign.Web",
      ).length,
      runtimeHashOnly: /^sha256-[A-Za-z0-9+/]{43}=$/.test(
        localStorage.getItem("blazor-resource-hash:SabuySign.Web") ?? "",
      ),
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0, runtimeHashOnly: true });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "กรอกข้อความภาษาไทยและเซ็น PDF ออนไลน์",
      exact: true,
    }),
  ).toBeVisible();
});

test("drag, zoom, font size, page navigation and invalid file preserve current work", async ({
  page,
}) => {
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await page
    .getByRole("button", { name: "เพิ่มข้อความ", exact: true })
    .first()
    .click();
  await page.locator("#page-surface").click({ position: { x: 80, y: 150 } });
  await page.getByLabel("ข้อความที่เลือก").fill("กำ น้ำ ทำ น้ำ สมชาย");
  await page.getByLabel("ข้อความที่เลือก").blur();
  await chooseDropdown(page, "ระดับซูม", "1");
  const before = await page.locator(".text-object").boundingBox();
  await expect(page.getByLabel("ลากเพื่อย้ายข้อความ")).toHaveCount(0);
  await page.mouse.move(before!.x + 30, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + 90, before!.y + before!.height / 2 + 30, {
    steps: 8,
  });
  await page.mouse.up();
  const after = await page.locator(".text-object").boundingBox();
  expect(after!.x - before!.x).toBeCloseTo(60, 0);
  expect(after!.y - before!.y).toBeCloseTo(30, 0);
  await chooseDropdown(page, "ระดับซูม", "1.5");
  await expect
    .poll(async () => (await page.locator(".text-object").boundingBox())!.width)
    .toBeCloseTo(after!.width * 1.5, 0);
  await page.getByLabel("ขนาดตัวอักษร", { exact: true }).fill("20");
  await page.getByLabel("ขนาดตัวอักษร", { exact: true }).blur();
  await expect
    .poll(async () => (await page.locator(".text-object").boundingBox())!.width)
    .toBeGreaterThan(after!.width * 1.5);
  await page.getByRole("button", { name: "หน้า 2", exact: true }).click();
  await expect(page.locator(".text-object")).toHaveCount(0);
  await page.getByRole("button", { name: "หน้า 1", exact: true }).click();
  await expect(page.locator(".text-object textarea")).toHaveValue(
    "กำ น้ำ ทำ น้ำ สมชาย",
  );
  page.once("dialog", (d) => d.accept());
  await page.locator("#pdf-file").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".text-object textarea")).toHaveValue(
    "กำ น้ำ ทำ น้ำ สมชาย",
  );
  await page.getByLabel("ปิดข้อความแจ้งเตือน").click();
  await chooseDropdown(page, "ระดับซูม", "1");
  await page.screenshot({ path: "artifacts/editor.png", fullPage: true });
  await page
    .getByRole("button", { name: "ดูตัวอย่าง PDF", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "artifacts/preview.png" });
  await page.getByRole("button", { name: "ปิดตัวอย่าง", exact: true }).click();
  const databases = await page.evaluate(() => indexedDB.databases());
  expect(databases).toEqual([]);
});
test("tool directory filters categories and remains readable on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "ทั้งหมด", exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "จัดการ PDF ออนไลน์ ให้เป็นเรื่องง่าย" }),
  ).toBeVisible();
  await expect(page.locator(".document-tool")).toHaveCount(11);
  await expect(page.locator(".document-tool.upcoming")).toHaveCount(0);
  await page.getByRole("button", { name: "แปลงเอกสาร", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "แปลงเอกสาร", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".document-tool")).toHaveCount(4);
  await expect(page.locator(".document-tool").first()).toContainText(
    "JPG / PNG เป็น PDF",
  );
  await expect(page.locator(".document-tool").first()).toContainText(
    "แปลงเอกสาร",
  );
  await expect(page.locator(".document-tool button")).toHaveCount(0);
  await page.getByRole("button", { name: "ทั้งหมด", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".document-tool")).toHaveCount(11);
  await page
    .getByRole("button", { name: "วิดีโอและเสียง", exact: true })
    .click();
  await expect(page.locator(".document-tool")).toHaveCount(2);
  await expect(
    page.locator(".document-tool").filter({ hasText: "วิดีโอเป็น GIF" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  const rows = await page.locator(".document-tool").evaluateAll((cards) => {
    const counts = new Map<number, number>();
    for (const card of cards) {
      const top = Math.round(card.getBoundingClientRect().top);
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts.values()];
  });
  expect(rows).toEqual([3, 3, 3, 2]);
  await expect(
    page.locator('.site-navigation a[href="/tools/pdf-to-powerpoint"]'),
  ).toHaveCount(2);
  await page.screenshot({ path: "artifacts/home.png", fullPage: true });
  await page.setViewportSize({ width: 820, height: 1000 });
  const lastCard = await page.locator(".document-tool").last().boundingBox();
  expect(Math.abs(lastCard!.x + lastCard!.width / 2 - 410)).toBeLessThan(2);
  await page.screenshot({ path: "artifacts/home-tablet.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/home-mobile.png", fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("typing directly then dragging preserves text and warns before losing edits", async ({
  page,
}) => {
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "inline.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await page
    .getByRole("button", { name: "เพิ่มข้อความ", exact: true })
    .first()
    .click();
  await page.locator("#page-surface").click({ position: { x: 100, y: 150 } });
  await page.locator(".text-object textarea").fill("น้ำ กำ สมชาย");
  await page.locator(".workspace-caption").click();
  const box = (await page.locator(".text-object").boundingBox())!;
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 44, box.y + box.height / 2 + 25, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".text-object textarea")).toHaveValue(
    "น้ำ กำ สมชาย",
  );
  await page
    .getByRole("button", { name: "ดูตัวอย่าง PDF", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ดาวน์โหลดไฟล์นี้", exact: true })
    .click();
  await page.getByRole("button", { name: "ปิดตัวอย่าง", exact: true }).click();
  await page.locator(".text-object textarea").dblclick();
  await page.locator(".text-object textarea").fill("ยังไม่ได้ดาวน์โหลด");
  const prompt = page.waitForEvent("dialog");
  const reload = page.reload({ timeout: 2000 }).catch(() => {});
  const dialog = await prompt;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await reload.catch(() => {});
  await expect(page.locator(".text-object textarea")).toHaveValue(
    "ยังไม่ได้ดาวน์โหลด",
  );
});

test("cards navigate to dedicated tool pages before asking for a file", async ({
  page,
}) => {
  let pickers = 0;
  page.on("filechooser", () => pickers++);
  for (const [id, name] of [
    ["fill-sign", "กรอกและเซ็น PDF"],
    ["merge", "รวมไฟล์ PDF"],
    ["compress", "ลดขนาด PDF"],
    ["word-to-pdf", "Word เป็น PDF"],
  ]) {
    await page.goto("/");
    const card = page
      .locator(".document-tool")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card.click({ position: { x: 12, y: 12 } });
    await expect(page).toHaveURL(new RegExp(`/tools/${id}$`));
    await expect(
      page.getByRole("heading", {
        name:
          id === "fill-sign"
            ? "กรอกข้อความภาษาไทยและเซ็น PDF ออนไลน์"
            : id === "word-to-pdf"
              ? "แปลง Word เป็น PDF"
              : name,
        exact: true,
      }),
    ).toBeVisible();
    expect(pickers).toBe(0);
    if (id === "fill-sign" || id === "merge" || id === "compress")
      await expect(
        page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
      ).toBeEnabled();
    else if (id === "word-to-pdf")
      await expect(
        page.getByRole("button", { name: "เลือกไฟล์ Word", exact: true }),
      ).toBeEnabled();
    else {
      await expect(
        page.getByRole("heading", { name: "เครื่องมือนี้กำลังพัฒนา" }),
      ).toBeVisible();
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
    }
  }
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "artifacts/tool-fill-sign.png",
    fullPage: true,
  });
  const choosing = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "เลือกไฟล์ PDF", exact: true })
    .click();
  await (await choosing).setFiles([]);
  expect(pickers).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "กรอกข้อความภาษาไทยและเซ็น PDF ออนไลน์",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/tool-fill-sign-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.goto("/tools/missing");
  await expect(
    page.getByRole("heading", { name: "ไม่พบเครื่องมือนี้" }),
  ).toBeVisible();
});

test("shared navigation has direct tools, grouped dropdowns and mobile keyboard support", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "เมนูหลัก", exact: true });
  await expect(
    nav.getByRole("link", { name: "แยก PDF", exact: true }),
  ).toHaveAttribute("href", "/tools/split");
  const convert = nav.locator("summary").filter({ hasText: "แปลง PDF" });
  const all = nav.locator("summary").filter({ hasText: "เครื่องมือทั้งหมด" });
  await convert.click();
  await expect(nav.locator(".convert-dropdown")).toBeVisible();
  await expect(
    nav
      .locator(".convert-dropdown")
      .getByRole("heading", { name: "แปลงเป็น PDF" }),
  ).toBeVisible();
  await expect(
    nav
      .locator(".convert-dropdown")
      .getByRole("heading", { name: "แปลงจาก PDF" }),
  ).toBeVisible();
  for (const width of [1001, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const trigger = (await convert.boundingBox())!;
    const panel = (await nav.locator(".convert-dropdown").boundingBox())!;
    expect(
      Math.abs(panel.x + panel.width / 2 - trigger.x - trigger.width / 2),
    ).toBeLessThan(2);
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    expect(Math.abs(panel.y - trigger.y - trigger.height)).toBeLessThan(2);
  }
  await page.screenshot({ path: "artifacts/convert-alignment.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await all.click();
  await expect(nav.locator(".all-tools-dropdown")).toBeVisible();
  await expect(nav.locator(".convert-dropdown")).toBeHidden();
  await page.screenshot({ path: "artifacts/navigation-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(nav.locator(".all-tools-dropdown")).toBeHidden();
  await expect(all).toBeFocused();
  await convert.hover();
  await expect(nav.locator(".convert-dropdown")).toBeVisible();
  // The expanded conversion menu can cover the hero heading; click the
  // exposed edge of the hero to exercise an actual outside pointer event.
  await page.locator(".tools-hero").click({ position: { x: 10, y: 10 } });
  await expect(nav.locator(".convert-dropdown")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "เปิดเมนูเครื่องมือ" }).click();
  await convert.click();
  await expect(nav.locator(".convert-dropdown")).toBeVisible();
  await page.screenshot({ path: "artifacts/navigation-mobile.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await nav
    .locator(".convert-dropdown")
    .getByRole("link", { name: "PDF เป็น Word" })
    .click();
  await expect(page).toHaveURL(/\/tools\/pdf-to-word$/);
  // The heading is SSR; wait for hydration before testing the interactive header.
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "PDF เป็น Word", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "เปิดเมนูเครื่องมือ" }).click();
  await expect(
    page.getByRole("navigation", { name: "เมนูหลัก", exact: true }),
  ).toBeVisible();
});

test("text frame follows content and font size; inline delete supports undo", async ({
  page,
}) => {
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  await page.locator("#pdf-file").setInputFiles({
    name: "text-frame.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await page
    .getByRole("button", { name: "เพิ่มข้อความ", exact: true })
    .first()
    .click();
  await page.locator("#page-surface").click({ position: { x: 90, y: 150 } });
  const text = page.locator(".text-object textarea");
  await text.fill("น้ำ");
  const small = (await page.locator(".text-object").boundingBox())!;
  await text.fill("ชื่อผู้สมัคร น้ำ กุ้ง ปู่\nที่อยู่ กรุงเทพมหานคร\nลายเซ็น");
  await expect
    .poll(
      async () => (await page.locator(".text-object").boundingBox())!.height,
    )
    .toBeGreaterThan(small.height * 2);
  await expect(
    page.getByLabel("ปรับขนาดกล่องข้อความ", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("ความกว้าง", { exact: true })).toHaveCount(0);
  const normal = (await page.locator(".text-object").boundingBox())!;
  await page.getByLabel("ขนาดตัวอักษร", { exact: true }).fill("24");
  await page.getByLabel("ขนาดตัวอักษร", { exact: true }).blur();
  await expect
    .poll(async () => (await page.locator(".text-object").boundingBox())!.width)
    .toBeGreaterThan(normal.width);
  expect(
    await text.evaluate((t) => ({
      x: t.scrollWidth <= t.clientWidth,
      y: t.scrollHeight <= t.clientHeight,
    })),
  ).toEqual({ x: true, y: true });
  const box = (await text.boundingBox())!;
  const remove = page
    .locator(".text-object")
    .getByRole("button", { name: "ลบข้อความ", exact: true });
  const button = (await remove.boundingBox())!;
  expect(button.y + button.height).toBeLessThanOrEqual(box.y);
  await page.screenshot({ path: "artifacts/text-frame.png" });
  await remove.click();
  await expect(page.locator(".text-object")).toHaveCount(0);
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(text).toHaveValue(
    "ชื่อผู้สมัคร น้ำ กุ้ง ปู่\nที่อยู่ กรุงเทพมหานคร\nลายเซ็น",
  );
  await page
    .getByRole("button", { name: "ดูตัวอย่าง PDF", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
