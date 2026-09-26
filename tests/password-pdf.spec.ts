import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import createQpdf from "@neslinesli93/qpdf-wasm";

async function fixture(restricted = false) {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawText("Original text");
  const q = await createQpdf({
    locateFile: () =>
      new URL(
        "../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm",
        import.meta.url,
      ).pathname,
  });
  (q.FS as any).writeFile("/in.pdf", await doc.save());
  q.callMain([
    "/in.pdf",
    "--encrypt",
    "test-pass",
    "owner-pass",
    "256",
    ...(restricted ? ["--modify=none"] : []),
    "--",
    "/out.pdf",
  ]);
  return {
    name: "locked.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(q.FS.readFile("/out.pdf")),
  };
}

test("encrypted PDF retries password locally, fills Thai and exports an unencrypted document", async ({
  page,
}) => {
  const writes: string[] = [],
    logs: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(r.url());
    expect(r.url()).not.toContain("test-pass");
  });
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  await page.locator("#pdf-file").setInputFiles(await fixture());
  const dialog = page.getByRole("dialog", {
    name: "กรอกรหัสผ่านเพื่อเปิด PDF",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "ไฟล์ที่ดาวน์โหลดหลังแก้ไขจะไม่มีรหัสผ่าน",
  );
  const input = dialog.getByLabel("รหัสผ่านเอกสาร", { exact: true });
  await input.fill("wrong");
  await dialog.getByRole("button", { name: "เปิดเอกสาร", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("รหัสผ่านไม่ถูกต้อง");
  await input.fill("test-pass");
  await dialog.getByRole("button", { name: "แสดงรหัสผ่าน" }).click();
  await expect(input).toHaveAttribute("type", "text");
  await dialog.getByRole("button", { name: "ซ่อนรหัสผ่าน" }).click();
  await page.screenshot({ path: "artifacts/pdf-password-desktop.png" });
  await dialog.getByRole("button", { name: "เปิดเอกสาร", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#page-canvas")).toBeVisible();
  await page
    .getByRole("button", { name: "เพิ่มข้อความ", exact: true })
    .first()
    .click();
  await page.locator("#page-surface").click({ position: { x: 100, y: 180 } });
  await page.getByLabel("ข้อความที่เลือก").fill("ชื่อ น้ำ กุ้ง ปู่");
  await page.getByLabel("ข้อความที่เลือก").blur();
  await page
    .getByRole("button", { name: "ดูตัวอย่าง PDF", exact: true })
    .click();
  await expect(page.locator("#preview-password-note")).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลดไฟล์นี้", exact: true })
    .click();
  const bytes = await readFile((await (await download).path())!);
  const output = await PDFDocument.load(bytes);
  expect(output.isEncrypted).toBe(false);
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).node.Contents()).toBeTruthy();
  const parseTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const parsed = await parseTask.promise;
  try {
    const content = await (await parsed.getPage(1)).getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(text).toContain("Original text");
    expect(text).toContain("น้ำ");
    expect(text.replace(/\s/g, "")).toContain("ชื่อน้ำกุ้งปู่");
  } finally {
    await parseTask.destroy();
  }
  expect(writes).toEqual([]);
  expect(logs.join(" ")).not.toMatch(
    /test-pass|owner-pass|recovereduserpassword/,
  );
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test("mobile cancel keeps upload usable and restricted documents require owner password", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/fill-sign");
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  const file = await fixture(true);
  await page.locator("#pdf-file").setInputFiles(file);
  const dialog = page.getByRole("dialog", {
    name: "กรอกรหัสผ่านเพื่อเปิด PDF",
  });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: "artifacts/pdf-password-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  await page.locator("#pdf-file").setInputFiles(file);
  await dialog.getByLabel("รหัสผ่านเอกสาร", { exact: true }).fill("test-pass");
  await dialog.getByRole("button", { name: "เปิดเอกสาร", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("จำกัดการแก้ไข");
  await dialog.getByLabel("รหัสผ่านเอกสาร", { exact: true }).fill("owner-pass");
  await dialog.getByRole("button", { name: "เปิดเอกสาร", exact: true }).click();
  await expect(page.locator("#page-canvas")).toBeVisible();
});
