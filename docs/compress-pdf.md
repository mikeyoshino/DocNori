# Local PDF compression

`/tools/compress` is prerendered by Blazor (including the introduction, FAQ,
canonical URL and metadata). Interactive WebAssembly starts the file picker.
Document bytes stay in browser memory. No conversion API, storage or third-party
advertising loader is used on this route.

One PDF, up to 50 MiB and 100 pages. Encrypted documents and signature fields /
certified PDFs are rejected, since rewriting invalidates digital signatures.

A dedicated Web Worker parses and rewrites the existing document with pdf-lib.
It preserves page content streams (including Thai text), forms, geometry and
references. Eligible images are opaque 8-bit DeviceRGB JPEG XObjects with no
masks, decode parameters or custom decoding. Images larger than 16 million
pixels are left unchanged. Their actual JPEG frame dimensions are checked before
decoding; images are processed one at a time and bitmaps/canvases released.

Presets: high (longest edge 2400px, JPEG quality .88), balanced (1600px, .72),
small (1000px, .5). Images are never enlarged. Other image formats remain intact;
this is not whole-page rasterization or OCR. Object streams are enabled on save.
The original bytes are returned if the result is not smaller. No savings target
is promised. Preview uses PDF.js and caps decoded image sizes and canvas size.

A two-minute worker timeout prevents indefinite processing; leaving/unmounting
terminates work. Preview tasks are destroyed, download URLs revoked, and no
local storage or IndexedDB is used. Unsupported OffscreenCanvas browsers receive
an update-browser message. Closing the page discards work.

Verification: `tests/compress.test.ts` covers preservation, bounds, signatures,
image eligibility, replacement and non-growing output. `tests/compress.spec.ts`
checks no-JS SSR, Thai text extraction, real JPEG compression in the worker,
page rotation, original/result preview, mobile overflow, navigation guards,
corrupt-file recovery, unchanged output and absence of document upload requests.
