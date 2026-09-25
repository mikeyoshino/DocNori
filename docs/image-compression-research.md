# JPG / PNG compression: research and validation

Date: 2026-09-25. Scope: `/tools/compress-image`, browser-only. This is a practical selection for DocNori, not a claim of the best encoder for every image.

## Decision

- JPG: MozJPEG via pinned `@jsquash/jpeg@1.6.0`, progressive and optimized coding. High quality is 94 with 4:4:4 (sampling factor **1**, not 0). Balanced is 88/4:4:4; small is 80/4:2:0. No resizing. Re-encoding is lossy; users can compare at actual size.
- PNG: OxiPNG via pinned `@jsquash/oxipng@2.3.0`, original PNG bytes, level 2, `optimiseAlpha=false`. No palette quantization or canvas round-trip of final output. Transparency is retained; animated PNG is rejected rather than silently flattened.
- Return the original when the candidate is empty, equal in size or larger. Report that it was already small; never invent a reduction percentage.
- Sequential disposable workers, 90-second timeout per task, 20 inputs, 20 MiB each, 100 MiB aggregate, maximum 24 million pixels. Workers and local file references/URLs are cleared when leaving. A cached return starts empty and usable.
- Decode orientation for JPEG before encoding. Re-encoded JPEG uses browser-decoded screen colors and does not copy camera/GPS metadata. An unchanged original still retains its metadata. HDR/wide-gamut fidelity is not guaranteed.
- Source-dependent result: lossless PNG cannot always shrink substantially. No fixed percentage or zero-loss JPG promise.

## Alternatives considered

| Option | Assessment |
| --- | --- |
| Native canvas encoder | Simple and useful for decoding/thumbnails, but limited JPEG coding controls and no PNG compression-level API. Not used as final compressor. |
| MozJPEG | Established browser WASM packaging, progressive/entropy and chroma controls. Chosen for implementation maturity plus measured reduction, not universal superiority. |
| OxiPNG | Lossless PNG optimization. Chosen to honor quality and transparency rather than change formats. |
| pngquant | Palette quantization can reduce PNG more, but is lossy. Excluded from this quality-first initial version. |
| JPEGli | Promising high-quality JPEG results, including human preference research. Worth a separate browser-package/quality benchmark; not evaluated head-to-head here, so this report does not claim MozJPEG beats it. |
| Server image processing | Can offload weak devices but changes privacy, operations and upload requirements. Current implementation stays local like the existing image tools. |

## Evidence from output files

Chromium, high quality default, 2026-09-25:

| Input | Bytes before → after | Validation |
| --- | --- | --- |
| Synthetic 900 × 600 gradient/shapes/Thai-text JPEG, source canvas quality 1 | 362,384 → 121,659 (66.4% smaller) | Same dimensions; RGB PSNR 43.15 dB versus decoded source |
| Synthetic 640 × 480 PNG with transparent and semitransparent regions, deliberately uncompressed DEFLATE | 1,229,528 → 2,422 | Same dimensions; decoded RGBA maximum difference 0 |
| Optimized 1 × 1 PNG fixture | Original retained | Byte equality verified |
| Mozilla `testimages/testorig.jpg` photo fixture | 5,770 → 5,770 | Already-compressed original retained byte-for-byte |

The PNG fixture intentionally tests actual DEFLATE optimization. Its 99.8% result is **not representative** of normally compressed PNG files. The JPEG synthetic source is unusually high quality; its reduction must not be advertised as a typical rate. PSNR is a limited pixel metric, not proof of perceptual equivalence for every photo, color profile or Thai character. The photo fixture stays in `/private/tmp` and is not redistributed.

Browser tests also cover SSR, no advertising script, no upload requests, before/after preview, ZIP output, invalid-file preservation, smaller-or-original behavior, decoded-format file names, mobile overflow and departure/return cleanup. Unit tests cover candidate selection, quality settings, animated/truncated PNG and pixel limits. Real-device Safari/iOS testing remains a follow-up.

## Sources

- [Mozilla MozJPEG](https://github.com/mozilla/mozjpeg)
- [Squoosh](https://github.com/GoogleChromeLabs/squoosh)
- [MozJPEG encoder binding: sampling factors](https://github.com/GoogleChromeLabs/squoosh/blob/dev/codecs/mozjpeg/enc/mozjpeg_enc.cpp)
- [jSquash JPEG browser API](https://github.com/jamsinclair/jSquash/tree/main/packages/jpeg)
- [jSquash OxiPNG options](https://github.com/jamsinclair/jSquash/tree/main/packages/oxipng)
- [OxiPNG](https://github.com/oxipng/oxipng)
- [pngquant](https://pngquant.org/)
- [Google JPEGli](https://github.com/google/jpegli)
- [JPEGli human preference research](https://arxiv.org/abs/2403.18589)
- [Mozilla photo fixture](https://github.com/mozilla/mozjpeg/blob/master/testimages/testorig.jpg)

Package Apache-2.0 licenses and underlying codec license texts are distributed with the local browser assets under `/js/licenses/`.
