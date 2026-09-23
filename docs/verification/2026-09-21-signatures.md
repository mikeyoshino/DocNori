# Signature verification — 2026-09-21

## Result

Implemented separate desktop and phone creation/save screens, an in-memory desktop library, drag/click placement, proportional resize, reusable vector ink, shared Undo/Redo, and export through the existing PDF preview/download flow. No account persistence or document upload was added.

## Checks run

- `npm test`: 22 tests passed. Includes exact Thai Unicode preservation, vector signature streams, signature-only exports on cropped/rotated pages with UserUnit, repeated placement/history, input validation, AES-GCM authentication/session binding and active-pointer undo regression.
- `dotnet test tests/SabuySign.Relay.Tests --no-restore`: 3 tests passed. Checks separate owner/writer capabilities, idempotent retries, overwrite rejection, ACK clearing, expiry/capacity, invalid payload bounds and cancellation.
- `APP_URL=http://127.0.0.1:8080 npm run test:e2e`: 7 Chromium tests passed against the Docker Release build. Includes four existing editor cases plus desktop signing/export, isolated mobile browser context signing/cancellation, and delayed ACK versus a replacement QR.
- `npm run typecheck`, `npm run format:check`, `npm run build`: passed.
- `dotnet format SabuySign.slnx --verify-no-changes --no-restore`: passed.
- `dotnet build --no-restore`: passed with zero warnings/errors.
- Docker Compose build/start passed. Web at loopback port 8080, relay internal only, PostgreSQL profile still healthy with no public port. Relay logs were empty after browser tests.

## Privacy and lifecycle evidence

Desktop signing produces no POST requests. Phone signing sends ciphertext only; browser test checks its upload has neither stroke JSON nor PDF header, and no localStorage/sessionStorage data is written. Cryptographic unit tests independently prove decryption, session binding and tamper rejection. The phone URL fragment is removed after parsing, and reload requires scanning again. Cancelled pairings reject subsequent access after the DELETE response. No PDF filename, bytes or page data are supplied to the mobile API.

Independent review found a stale ACK response could close a newer QR and that undo during an active pointer stroke could corrupt drawing state. Both are fixed and covered. Browser testing also found same-document QR hash navigation did not reinitialize the mobile screen; it now aborts old requests/listeners and initializes the new pairing. The cancellation test waits for DELETE completion rather than racing it.

Screenshots: `artifacts/signature-mobile.png`, `artifacts/signature-qr.png`, `artifacts/signature-preview.png`.

## Limits of this verification

The mobile flow was tested with a separate Chromium context at a 390px mobile viewport, not a physical phone or Safari. Actual phone use requires a trusted HTTPS origin reachable from both devices; localhost QR links only work on the same computer. No external deployment/tunnel was created.

The relay is a single in-memory instance. QR sessions expire after five minutes; ciphertext is cleared after ACK or expiry (15-second sweep). Refresh/close/replacing the PDF clears the desktop signature library. Users still need to download the resulting PDF. This feature creates handwritten vector marks, not certificate-based digital signatures. The existing manual Adobe Acrobat/Safari/representative-document checks remain applicable.

## Follow-up: smoother ink

Replaced straight point-to-point joins with a shared midpoint Bézier path used by canvas, SVG thumbnails/placements, and vector PDF export. The curve controls stay within captured point bounds and preserve stroke endpoints. The pad reads coalesced pointer samples when available, falls back to ordinary events, and captures the pointer-up position. Reference: [MDN getCoalescedEvents](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents). Stroke width remains constant; pressure-based width is not implemented.

Checks: 23 Node tests passed, including curve output and coalesced/end samples; TypeScript, formatting and client/Docker builds passed. Browser export assertion now requires actual Bézier operators in the downloaded PDF.

## Follow-up: live mouse pen feel

The curve-only change above did not address the user's live mouse-writing feedback. New drawings now use a `pen` brush with Perfect Freehand 1.2.3: streamlining 0.45, outline smoothing 0.7, base size 4, thinning 0.55 and a short tapered end. Pressure is simulated from sample spacing; this is not hardware pressure sensing. See the [upstream implementation](https://github.com/steveruizok/perfect-freehand) for the brush algorithm.

The live canvas paints a filled pen outline while dragging, rather than a uniform-width centerline. The saved `brush` marker survives validation/encryption and selects the same filled outline for SVG and PDF. Legacy strokes without the marker retain the preceding rendering. The shape is still vector ink, not a bitmap. No server or document-handling changes were needed.

Verified: 24 Node tests and 7 Docker Release browser tests passed; TypeScript, formatting, client build and Docker build passed. Tests exercise live fill rendering, simulated weight changes, cropping bounds, encrypted brush preservation, and actual filled Bézier paths in downloaded PDFs. The same synthetic input was rendered before/after in `artifacts/mouse-pen-comparison.png` and inspected visually. Subjective feel still needs the user's mouse trial; automated tests do not establish that it feels identical to a physical pen.
