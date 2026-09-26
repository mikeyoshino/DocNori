import { build } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
const dest = "src/SabuySign.Web/wwwroot/js";
await mkdir(dest, { recursive: true });
await build({
  entryPoints: {
    templates: "src/SabuySign.Web/Client/templates/index.ts",
    index: "src/SabuySign.Web/Client/editor/index.ts",
    "decrypt.worker": "src/SabuySign.Web/Client/editor/decrypt.worker.ts",
    "export.worker": "src/SabuySign.Web/Client/editor/export.worker.ts",
    "word-pdf": "src/SabuySign.Web/Client/word-pdf/index.ts",
    "video-audio": "src/SabuySign.Web/Client/video-audio/index.ts",
    "video-gif": "src/SabuySign.Web/Client/video-gif/index.ts",
    "image-compress": "src/SabuySign.Web/Client/image-compress/index.ts",
    "image-compress.worker":
      "src/SabuySign.Web/Client/image-compress/worker.ts",
    "image-tools": "src/SabuySign.Web/Client/image-tools/index.ts",
    "image-pdf.worker": "src/SabuySign.Web/Client/image-tools/pdf.worker.ts",
    "heic-jpg.worker": "src/SabuySign.Web/Client/image-tools/heic.worker.ts",
    compress: "src/SabuySign.Web/Client/compress/index.ts",
    "compress.worker": "src/SabuySign.Web/Client/compress/worker.ts",
    organize: "src/SabuySign.Web/Client/organize/index.ts",
    "organize.worker": "src/SabuySign.Web/Client/organize/worker.ts",
    split: "src/SabuySign.Web/Client/split/index.ts",
    merge: "src/SabuySign.Web/Client/merge/index.ts",
    "convert-word": "src/SabuySign.Web/Client/convert-word/index.ts",
    "convert-jpg": "src/SabuySign.Web/Client/convert-jpg/index.ts",
    site: "src/SabuySign.Web/Client/site.ts",
    navigation: "src/SabuySign.Web/Client/navigation/index.ts",
    mobile: "src/SabuySign.Web/Client/signatures/mobile.ts",
    dropdown: "src/SabuySign.Web/Client/shared/dropdown.ts",
  },
  alias: {
    "docnori-heif":
      "./node_modules/heic-to/src/lib/libheif-without-unsafe-eval.js",
  },
  external: ["fs", "path", "crypto"],
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
  "@neslinesli93/qpdf-wasm",
  "@jsquash/jpeg",
  "@jsquash/oxipng",
  "heic-to",
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

// Ship the decoder source and license alongside the LGPL browser bundle.
await cp("node_modules/heic-to/src", `${dest}/licenses/heic-to/src`, {
  recursive: true,
});
await copyFile(
  "node_modules/heic-to/esbuild.mjs",
  `${dest}/licenses/heic-to/esbuild.mjs`,
);
await copyFile(
  "node_modules/heic-to/package.json",
  `${dest}/licenses/heic-to/package.json`,
);

await mkdir(`${dest}/codecs`, { recursive: true });
await copyFile(
  "node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm",
  `${dest}/codecs/mozjpeg.wasm`,
);
await copyFile(
  "node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm",
  `${dest}/codecs/oxipng.wasm`,
);
for (const name of ["jpeg", "oxipng"])
  await copyFile(
    `node_modules/@jsquash/${name}/codec/LICENSE.codec.md`,
    `${dest}/licenses/@jsquash-${name}/LICENSE.codec.md`,
  );

await copyFile(
  "node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm",
  `${dest}/codecs/qpdf.wasm`,
);

await cp("third-party/qpdf", `${dest}/licenses/qpdf`, { recursive: true });
