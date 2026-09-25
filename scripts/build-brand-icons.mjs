// Raster fallbacks for the code-native SVG mark. Run only when the SVG changes.
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const root = "src/SabuySign.Web/wwwroot";
const svg = await readFile(`${root}/favicon.svg`, "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const images = [];
  for (const size of [16, 32, 48, 180]) {
    const encoded = await page.evaluate(
      async ({ svg, size }) => {
        const img = new Image();
        img.src = "data:image/svg+xml;base64," + btoa(svg);
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (size === 180) {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, 18, 18, 144, 144);
        } else ctx.drawImage(img, 0, 0, size, size);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { svg, size },
    );
    const png = Buffer.from(encoded, "base64");
    if (size === 32) await writeFile(`${root}/favicon-32x32.png`, png);
    if (size === 180) await writeFile(`${root}/apple-touch-icon.png`, png);
    else images.push({ size, png });
  }
  // ICO directory containing PNG images (16, 32 and 48px).
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const p = 6 + i * 16;
    header[p] = header[p + 1] = size;
    header.writeUInt16LE(1, p + 4);
    header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(png.length, p + 8);
    header.writeUInt32LE(offset, p + 12);
    offset += png.length;
  });
  await writeFile(
    `${root}/favicon.ico`,
    Buffer.concat([header, ...images.map((i) => i.png)]),
  );
} finally {
  await browser.close();
}
