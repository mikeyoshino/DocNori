# Signature creation and mobile pairing implementation

Goal: implement the approved two separate creation flows: draw on desktop/save, or scan QR/draw on phone/save; both produce a temporary signature asset on desktop to drag onto a PDF repeatedly.
Execution: inline, continuing the user's approved implementation. Existing editor behavior and tests remain binding. No git metadata exists in this workspace.

## Design decisions
- Signature library is browser memory only, scoped to the open document. Clear on close/replacement/reload. Saving confirms the drawing, not persistence/account storage.
- Signature pad uses normalized pointer strokes with crop-to-ink bounds and transparent background. Placements preserve aspect ratio, share undo/redo with text, and export vector ink to the PDF. No certificate-based signing is implied.
- Phone page is a dedicated `/sign` screen with only the pad, clear and save. It never receives the PDF or its metadata.
- Add a small .NET relay, separate feature folders, in-memory bounded sessions (5 min TTL). No DB access, files, request body logging or telemetry. Tokens have different owner/write capabilities. Completed uploads cannot be overwritten; retries are idempotent; acknowledgement clears ciphertext. Cancel/expiry delete the session.
- Browser AES-256-GCM encryption with fresh IV and session-bound AAD. Key and writer token travel only in QR URL fragment, removed from phone address bar after parsing. Owner token never goes to phone. Relay stores hashes of capabilities and transient ciphertext, not plaintext strokes or crypto key.
- nginx proxies only `/api/pairing` to relay, disables access logs there, body size and request rate bounded. Static site remains GET/HEAD-only. No PDF upload endpoint.
- Actual phone access requires a shared reachable HTTPS origin. Localhost can demonstrate pairing across browser tabs; it is not a reachable phone URL. UI reports this honestly. No tunnel or public deployment is created automatically.

## Tasks and verification
- [x] Add pure stroke/crypto modules and tests for blank rejection, cropping, malformed payloads, encryption/decryption, tampering and session isolation.
- [x] Add session signature placement and PDF ink export tests for undo/redo, repeated placement, correct crop/rotation coordinates, preserving Thai text.
- [x] Add relay store and endpoints with tests for capability separation, replay/idempotency, TTL, capacity, request size and ACK clearing.
- [x] Add desktop source picker, desktop pad/save dialog, QR dialog/cancel/status and mobile pad/save page. Add draggable/reusable library and signature property controls.
- [x] Add relay Docker/Compose/proxy, maintain static CSP, document deployment requirements, and run unit/format/build + existing and signature browser tests on Docker Release.

## Review focus
Late arrivals after cancel/document switch must not leak into another document. Empty strokes cannot save. Slow/error responses must preserve drawing for retry. Mobile save cannot overwrite accepted signatures. Placed ink remains after deleting its library asset. Pending sessions and observers are cleaned up without storing documents. Keys and tokens must not appear in logs, query parameters, or API payloads (except capability Authorization headers and hashed writer registration).

Review: independent code review found and fixed stale ACK handling and undo during active touch drawing. Browser regression also covers reopening QR links in the same mobile tab.
