import { build } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
const dest = "src/SabuySign.Web/wwwroot/js";
await mkdir(dest, { recursive: true });
await build({
  entryPoints: {
    index: "src/SabuySign.Web/Client/editor/index.ts",
    "export.worker": "src/SabuySign.Web/Client/editor/export.worker.ts",
    split: "src/SabuySign.Web/Client/split/index.ts",
    merge: "src/SabuySign.Web/Client/merge/index.ts",
    "convert-word": "src/SabuySign.Web/Client/convert-word/index.ts",
    "convert-jpg": "src/SabuySign.Web/Client/convert-jpg/index.ts",
    site: "src/SabuySign.Web/Client/site.ts",
    navigation: "src/SabuySign.Web/Client/navigation/index.ts",
    mobile: "src/SabuySign.Web/Client/signatures/mobile.ts",
    dropdown: "src/SabuySign.Web/Client/shared/dropdown.ts",
  },
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: dest,
  minify: true,
  legalComments: "linked",
});
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  `${dest}/pdf.worker.min.mjs`,
);
for (const dir of ["wasm", "cmaps", "standard_fonts"])
  await cp(`node_modules/pdfjs-dist/${dir}`, `${dest}/${dir}`, {
    recursive: true,
  });

// Preserve full dependency licenses alongside the distributed browser bundles.
const { readdir, readFile, writeFile } = await import("node:fs/promises");
const packages = [
  "docx",
  "jszip",
  "xml",
  "xml-js",
  "sax",
  "nanoid",
  "hash.js",
  "minimalistic-assert",
  "inherits",
  "lie",
  "immediate",
  "setimmediate",
  "readable-stream",
  "core-util-is",
  "isarray",
  "process-nextick-args",
  "safe-buffer",
  "string_decoder",
  "util-deprecate",
  "pdf-lib",
  "@pdf-lib/fontkit",
  "pdfjs-dist",
  "opentype.js",
  "@pdf-lib/standard-fonts",
  "@pdf-lib/upng",
  "pako",
  "tslib",
  "qrcode",
  "dijkstrajs",
  "perfect-freehand",
];
const inventory = [];
for (const name of packages) {
  const directory = `node_modules/${name}`;
  const pkg = JSON.parse(await readFile(`${directory}/package.json`, "utf8"));
  const target = `${dest}/licenses/${name.replaceAll("/", "-")}`;
  await mkdir(target, { recursive: true });
  for (const filename of await readdir(directory))
    if (/^(licen[sc]e|copying|notice)/i.test(filename))
      await cp(`${directory}/${filename}`, `${target}/${filename}`, {
        recursive: true,
      });
  inventory.push({ name, version: pkg.version, license: pkg.license });
}
await writeFile(
  `${dest}/licenses/inventory.json`,
  JSON.stringify(inventory, null, 2),
);
