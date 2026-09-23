# Third-party dependencies

Versions pinned in package-lock.json / csproj. This app bundles assets locally; no CDN runtime scripts or font requests.

| Dependency | Version | License |
| --- | --- | --- |
| ASP.NET Core Blazor WebAssembly | 10.0.10 | MIT |
| pdf-lib | 1.17.1 | MIT |
| @pdf-lib/fontkit | 1.1.1 | MIT |
| PDF.js (pdfjs-dist) | 6.3.289 | Apache-2.0 |
| OpenType.js | 2.0.0 | MIT |
| Sarabun Regular | vendored, SHA-256 below | SIL OFL 1.1 |
| @pdf-lib/standard-fonts | 1.0.0 | MIT |
| @pdf-lib/upng | 1.0.1 | MIT |
| pako | 1.0.11 | MIT AND Zlib |
| tslib | 1.14.1 | 0BSD |

PDF.js optional Node canvas packages use MIT and are for Node-side testing, not browser document processing. PDF.js also ships supporting font, CMap, WASM and decoder assets; bundled license files are preserved when copied. Build output includes legal comments and a licenses directory with full package notices. Node/npm development dependencies and platform-specific optional packages are recorded in package-lock.json.

Sarabun font source: https://github.com/google/fonts/tree/main/ofl/sarabun

Sarabun SHA-256: `226d4f368fbc0457990ddef2692679badfd2c1a4e89e5ac4d43c10ba7743b2f1`

Original font license/copyright: [OFL.txt](src/SabuySign.Web/wwwroot/fonts/OFL.txt). Generated PDF fonts are renamed `SabuyText`, carry OFL license metadata, and retain the source copyright notice in the embedded font. The document itself is not required to use the font's license.

No commercial PDF SDK is used. Review license obligations again when changing dependencies or distribution model.

- QR Code (`qrcode` 1.5.4, MIT) and `dijkstrajs` (MIT): client-side QR generation. Full licenses are distributed under `/js/licenses/`.

- `perfect-freehand` 1.2.3 (MIT, Steve Ruiz): local pen outline generation with mouse stabilization and simulated pressure. License is distributed under `/js/licenses/perfect-freehand/`.
