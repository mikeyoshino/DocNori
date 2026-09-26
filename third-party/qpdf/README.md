# QPDF browser dependency

The password-protected PDF editor uses `@neslinesli93/qpdf-wasm` 0.3.0
(package metadata: ISC), containing QPDF 12.2.0 (Apache-2.0), zlib and
libjpeg-turbo. Binary and JavaScript are installed from the pinned npm package.
Source/build recipe: https://github.com/neslinesli93/qpdf-wasm

Bundled upstream notices are retained in this directory and copied into the
public `js/licenses/qpdf` directory by scripts/build.mjs. zlib's license is
included in the header of zlib.h. The package's metadata is in the generated
license inventory. No QPDF source or binary modifications are applied.

The app runs QPDF in an ephemeral Web Worker with an in-memory filesystem.
It captures stdout/stderr rather than logging them (QPDF's encryption report
can contain a recovered password). Each attempt discards its worker; neither
password nor decrypted data is written to persistent browser storage.
