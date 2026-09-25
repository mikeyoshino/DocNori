import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import JSZip from "jszip";
function png() {
  const chunk = (type: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const n of payload) {
      crc ^= n;
      for (let j = 0; j < 8; j++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const head = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([head, payload, tail]);
  };
  const w = 640,
    h = 480,
    header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * (w * 4 + 1) + 1 + x * 4;
      pixels[p] = Math.floor(x / 20) * 7;
      pixels[p + 1] = Math.floor(y / 20) * 9;
      pixels[p + 2] = 160;
      pixels[p + 3] = x < 80 ? 0 : x < 160 ? 128 : 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function compare(page: Page, original: Buffer, output: Buffer) {
  return page.evaluate(
    async ({ a, b }) => {
      const decode = async (s: string) => {
        const blob = new Blob([
          Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
        ]);
        const image = await createImageBitmap(blob);
        const c = document.createElement("canvas");
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        image.close();
        return {
          w: c.width,
          h: c.height,
          p: ctx.getImageData(0, 0, c.width, c.height).data,
        };
      };
      const before = await decode(a),
        after = await decode(b);
      let mse = 0,
        max = 0;
      for (let i = 0; i < before.p.length; i++) {
        const d = Math.abs(before.p[i] - after.p[i]);
        if (i % 4 !== 3) mse += d * d;
        max = Math.max(max, d);
      }
      return {
        width: after.w,
        height: after.h,
        sameDimensions: before.w === after.w && before.h === after.h,
        max,
        psnr:
          mse === 0
            ? 100
            : 10 * Math.log10((255 * 255) / (mse / (before.w * before.h * 3))),
      };
    },
    { a: original.toString("base64"), b: output.toString("base64") },
  );
}
test("compression landing is SSR, private and describes real limitations", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/tools/compress-image`);
  await expect(page).toHaveTitle("ลดขนาดรูป JPG PNG ออนไลน์ฟรี — DocNori");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index,follow",
  );
  await expect(page.locator("[data-intro]")).toContainText("24 ล้านพิกเซล");
  await expect(page.locator('script[src*="adsbygoogle"]')).toHaveCount(0);
  await context.close();
});
test("real codecs reduce JPEG and transparent PNG with quality checks, compare and local ZIP", async ({
  page,
}) => {
  const errors: string[] = [],
    posts: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) posts.push(r.url());
  });
  await page.goto("/tools/compress-image");
  await expect(page.locator("[data-intro] [data-choose]")).toBeEnabled();
  const jpg = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 900;
      c.height = 600;
      const ctx = c.getContext("2d")!;
      const g = ctx.createLinearGradient(0, 0, 900, 600);
      g.addColorStop(0, "#eacdad");
      g.addColorStop(0.5, "#93afca");
      g.addColorStop(1, "#3a5137");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 900, 600);
      for (let i = 0; i < 250; i++) {
        ctx.fillStyle = `hsl(${(i * 13) % 360} 40% 50%)`;
        ctx.beginPath();
        ctx.arc((i * 37) % 900, (i * 51) % 600, 3 + (i % 18), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "white";
      ctx.fillRect(40, 240, 800, 90);
      ctx.fillStyle = "#182838";
      ctx.font = "32px Sarabun";
      ctx.fillText("เอกสารภาษาไทย กุ้ง น้ำ 12345", 60, 295);
      return c.toDataURL("image/jpeg", 1).split(",")[1];
    }),
    "base64",
  );
  const originalPng = png();
  await page.locator("[data-files]").setInputFiles([
    { name: "ภาพ.png", mimeType: "image/png", buffer: originalPng },
    { name: "ภาพ.jpg", mimeType: "image/jpeg", buffer: jpg },
  ]);
  await expect(page.locator(".image-card")).toHaveCount(2);
  await expect(page.locator("[data-convert]")).toBeEnabled();
  await page.locator("[data-convert]").click();
  await expect(page.locator("[data-summary]")).toContainText("2 / 2", {
    timeout: 60000,
  });
  const downloadEvent = page.waitForEvent("download");
  await page.locator("[data-zip]").click();
  const download = await downloadEvent;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const outPng = await zip.file("ภาพ.png")!.async("nodebuffer"),
    outJpg = await zip.file("ภาพ.jpg")!.async("nodebuffer");
  expect(outPng.length).toBeLessThan(originalPng.length * 0.8);
  expect(outJpg.length).toBeLessThan(jpg.length * 0.9);
  const pngQuality = await compare(page, originalPng, outPng),
    jpgQuality = await compare(page, jpg, outJpg);
  expect(pngQuality.max).toBe(0);
  expect(pngQuality.sameDimensions).toBe(true);
  expect(jpgQuality.sameDimensions).toBe(true);
  expect(jpgQuality.psnr).toBeGreaterThan(35);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/image-compression-benchmark.json",
    JSON.stringify(
      {
        png: {
          before: originalPng.length,
          after: outPng.length,
          ...pngQuality,
        },
        jpg: { before: jpg.length, after: outJpg.length, ...jpgQuality },
      },
      null,
      2,
    ),
  );
  await page.getByRole("button", { name: "เปรียบเทียบ" }).first().click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.locator("[data-actual]").check();
  await expect(page.locator("[data-compare]")).toHaveClass(/actual-size/);
  await page.getByRole("button", { name: "ปิดตัวอย่าง" }).click();
  await page.screenshot({
    path: "artifacts/image-compress-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/image-compress-mobile.png",
    fullPage: true,
  });
  await page.locator('input[value="balanced"]').check();
  await expect(page.locator("[data-zip]")).toBeHidden();
  await expect(page.locator("[data-convert]")).toBeEnabled();
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});
test("optimized originals are retained and invalid files preserve the batch", async ({
  page,
}) => {
  await page.goto("/tools/compress-image");
  await expect(page.locator("[data-intro] [data-choose]")).toBeEnabled();
  const tiny = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator("[data-files]").setInputFiles([
    { name: "tiny.png", mimeType: "image/png", buffer: tiny },
    { name: "bad.png", mimeType: "image/png", buffer: Buffer.from("broken") },
  ]);
  await expect(page.locator("[data-error]")).toContainText("bad.png");
  await expect(page.locator(".image-card")).toHaveCount(1);
  await page.locator("[data-convert]").click();
  await expect(page.locator("[data-summary]")).toContainText("1 / 1");
  await expect(page.locator(".image-card")).toContainText("เล็กอยู่แล้ว");
  const d = page.waitForEvent("download");
  await page.getByRole("link", { name: "ดาวน์โหลด", exact: true }).click();
  expect(await readFile((await (await d).path())!)).toEqual(tiny);
  await page.locator("[data-clear]").click();
  await expect(page.locator("[data-intro]")).toBeVisible();
});
test("decoded format names downloads correctly and leaving clears files for a fresh return", async ({
  page,
}) => {
  await page.goto("/tools/compress-image");
  await expect(page.locator("[data-intro] [data-choose]")).toBeEnabled();
  const jpg = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 100;
      const x = c.getContext("2d")!;
      x.fillStyle = "orange";
      x.fillRect(0, 0, 160, 100);
      return c.toDataURL("image/jpeg", 1).split(",")[1];
    }),
    "base64",
  );
  const file = { name: "wrong.png", mimeType: "image/png", buffer: jpg };
  await page.locator("[data-files]").setInputFiles(file);
  await expect(page.locator(".image-card")).toHaveCount(1);
  await expect(page.locator("[data-convert]")).toBeEnabled();
  await page.locator("[data-convert]").click();
  await expect(page.locator("[data-summary]")).toContainText("1 / 1");
  await expect(
    page.getByRole("link", { name: "ดาวน์โหลด", exact: true }),
  ).toHaveAttribute("download", "wrong.jpg");
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    ),
  );
  await expect(page.locator("[data-intro]")).toBeVisible();
  await expect(page.locator(".image-card")).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await page.locator("[data-files]").setInputFiles(file);
  await expect(page.locator(".image-card")).toHaveCount(1);
  await expect(page.locator("[data-convert]")).toBeEnabled();
  await page.locator("[data-convert]").click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    ),
  );
  await page.locator("[data-files]").setInputFiles(file);
  await expect(page.locator(".image-card")).toHaveCount(1);
  await expect(page.locator("[data-convert]")).toBeEnabled();
  await page.locator("[data-convert]").click();
  await expect(page.locator("[data-summary]")).toContainText("1 / 1");
});
