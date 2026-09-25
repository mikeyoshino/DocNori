# Local image tools

Separate SSR landing pages: `/tools/jpg-to-pdf` and `/tools/heic-to-jpg`.
Conversion runs in disposable browser workers; image files are not uploaded.

- Both tools: 20 files, 20 MiB each, 100 MiB total; decoded images at most 50 million pixels and 20,000 pixels per side.
- PDF: reorder, rotate, A4/Letter/image paper, orientation, margins, preview, download. Images are fitted without cropping, with a white background and maximum long side of 4,096 pixels. Generated PDF is limited to 100 MiB.
- HEIC: sequential decoding of the primary image, JPEG quality 0.92, individual downloads and ZIP with unique names. Partial failures retain successful images. Output total is limited to 100 MiB. Camera/GPS metadata and Live Photo video are not copied. HDR appearance may differ.
- Leaving the page terminates active workers; object URLs are revoked on disposal. Downloads must happen before closing the page.

## Decoder and redistribution

`heic-to@1.5.2` is LGPL-3.0 and uses libheif 1.22.2 / libde265 1.0.16. The build uses its CSP-compatible decoder without unsafe eval, loaded only when converting HEIC. The build ships the package license, source directory, package metadata and upstream build script under `/js/licenses/heic-to/`. Upstream: https://github.com/hoppergee/heic-to/tree/v1.5.2 . Consult the shipped dependency licenses when distributing a modified build.

## Verification

`tests/image-tools.test.ts` checks limits, dimensions, page fitting and duplicate-safe names. `tests/image-tools.spec.ts` checks SSR, PDF ordering/rotation/preview/output, actual HEIC decoding, partial failures, ZIP contents, mobile layout and absence of uploads.

`tests/fixtures/image-colors.heic` is a synthetic 320 × 240 image with a red left half and blue right half, generated locally using macOS `sips -s format heic input.png --out image-colors.heic`; it contains no user photograph. Browser assertions check output dimensions and both color regions.
