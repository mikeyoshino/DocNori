import { test, expect } from "@playwright/test";

test("AdSense loader is in the head of every public page and allowed by CSP", async ({
  request,
}) => {
  for (const path of [
    "/",
    "/tools/fill-sign",
    "/tools/merge",
    "/tools/missing",
  ]) {
    const response = await request.get(path);
    const html = await response.text();
    const csp = response.headers()["content-security-policy"];
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    const script =
      /<script\b[^>]*src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-1030637351071742"[^>]*><\/script>/.exec(
        html,
      )?.[0];
    expect(script).toBeTruthy();
    expect(script).toContain("async");
    expect(script).toContain('crossorigin="anonymous"');
    expect(
      script?.replace(/&#x([0-9a-f]+);/gi, (_, value) =>
        String.fromCodePoint(parseInt(value, 16)),
      ),
    ).toContain(`nonce="${nonce}"`);
    expect(html.indexOf(script!)).toBeLessThan(html.indexOf("</head>"));
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-src https:");
  }
});

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
    page.getByRole("heading", { name: "จัดการ PDF ออนไลน์ ให้เป็นเรื่องง่าย" }),
  ).toBeVisible();
  await expect(page.locator(".document-tool")).toHaveCount(9);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "http://localhost:8080/",
  );
  for (const [slug, title] of [
    ["merge", "รวมไฟล์ PDF"],
    ["split", "แยกไฟล์ PDF"],
    ["fill-sign", "กรอกข้อความภาษาไทยและเซ็น PDF ออนไลน์"],
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
        ? "กรอกข้อความและเซ็น PDF ออนไลน์ฟรี — DocNory"
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

test("target pages expose consistent structured data without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const path of ["/", "/tools/fill-sign"]) {
    await page.goto(path);
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    const schema = JSON.parse(
      await page.locator('script[type="application/ld+json"]').innerText(),
    );
    expect(schema["@context"]).toBe("https://schema.org");
    const nodes = schema["@graph"];
    expect(nodes.find((node: any) => node["@type"] === "WebPage").url).toBe(
      canonical,
    );
    expect(
      nodes.some((node: any) => ["FAQPage", "HowTo"].includes(node["@type"])),
    ).toBe(false);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      "content",
      "DocNory",
    );
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
      "content",
      await page.title(),
    );
    if (path === "/") {
      expect(nodes.find((node: any) => node["@type"] === "WebSite").name).toBe(
        "DocNory",
      );
      await expect(page).toHaveTitle(
        "เครื่องมือจัดการ PDF ออนไลน์ รองรับภาษาไทย — DocNory",
      );
    } else {
      const app = nodes.find((node: any) => node["@type"] === "WebApplication");
      expect(app.url).toBe(canonical);
      expect(app.offers.price).toBe(0);
      expect(app.aggregateRating).toBeUndefined();
      expect(
        nodes.find((node: any) => node["@type"] === "BreadcrumbList")
          .itemListElement[1].item,
      ).toBe(canonical);
      await expect(
        page.getByRole("link", { name: "รวมไฟล์ PDF ก่อนเซ็น", exact: true }),
      ).toBeVisible();
    }
  }
  await context.close();
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
  await expect(page.locator(".document-tool")).toHaveCount(5);
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
