import { test, expect } from "@playwright/test";

test("public pages contain real HTML and metadata without JavaScript", async ({
  browser,
  request,
}) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("data-tool-directory");
  expect(html).toContain('href="/tools/merge"');
  expect(html).toContain('<meta name="description"');
  expect(html).not.toContain('"type":"server"');
  const csp = response.headers()["content-security-policy"];
  const nonce = /'nonce-([^']+)'/.exec(csp)![1];
  expect(
    html.replace(/&#x([0-9a-f]+);/gi, (_, value) =>
      String.fromCodePoint(parseInt(value, 16)),
    ),
  ).toContain(`nonce="${nonce}"`);
  expect(csp.split("script-src")[1].split(";")[0]).not.toContain(
    "unsafe-inline",
  );
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(response.url());
  await expect(
    page.getByRole("heading", { name: "จัดการเอกสาร ให้เป็นเรื่องง่าย" }),
  ).toBeVisible();
  await expect(page.locator(".document-tool")).toHaveCount(6);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "http://localhost:8080/",
  );
  for (const [slug, title] of [
    ["merge", "รวมไฟล์ PDF"],
    ["split", "แยกไฟล์ PDF"],
    ["fill-sign", "เซ็น PDF ออนไลน์ และกรอกข้อความ"],
  ]) {
    const response = await page.goto(
      new URL(`/tools/${slug}`, page.url()).href,
    );
    expect(response!.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(
      slug === "fill-sign"
        ? "เซ็น PDF ออนไลน์ฟรี พร้อมกรอกข้อความ — DocNory"
        : `${title} — DocNory`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index,follow",
    );
    await expect(
      page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
    ).toBeDisabled();
  }
  const missing = await page.goto(new URL("/tools/missing", page.url()).href);
  expect(missing!.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "ไม่พบเครื่องมือนี้" }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,follow",
  );
  await context.close();
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain("http://localhost:8080/tools/merge");
  expect(await sitemap.text()).not.toContain("/sign<");
  expect(await sitemap.text()).not.toContain("compress");
  expect(await (await request.get("/robots.txt")).text()).toContain(
    "Disallow: /sign",
  );
  const alias = await request.get("/tools/merg", { maxRedirects: 0 });
  expect(alias.status()).toBe(301);
  expect(alias.headers().location).toBe("/tools/merge");
});

test("signing page explains the real workflow and static assets can be cached", async ({
  request,
}) => {
  const page = await request.get("/tools/fill-sign");
  expect(page.headers()["cache-control"]).toContain("no-store");
  const html = await page.text();
  expect(html).toContain("เซ็น PDF ออนไลน์");
  expect(html).toContain("วาดลายเซ็นบนคอมพิวเตอร์");
  expect(html).toContain("สแกน QR Code");
  expect(html).toContain("ลายเซ็นดิจิทัลที่ใช้ใบรับรอง");

  const script = await request.get("/_framework/blazor.web.js");
  expect(script.status()).toBe(200);
  expect(script.headers()["cache-control"] ?? "").not.toContain("no-store");
});

test("landing uses static SSR and tools start only the WebAssembly runtime", async ({
  page,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "แปลงไฟล์", exact: true }).click();
  await expect(page.locator(".document-tool")).toHaveCount(2);
  expect(
    requests.filter((url) => /\.wasm(?:\?|$)|blazor\.boot|_blazor\//.test(url)),
  ).toEqual([]);
  await page.getByRole("link", { name: "รวม PDF", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "เลือกไฟล์ PDF", exact: true }),
  ).toBeEnabled();
  expect(requests.some((url) => /\.wasm(?:\?|$)/.test(url))).toBe(true);
  expect(requests.some((url) => url.includes("/_blazor"))).toBe(false);
  expect(errors).toEqual([]);
});
