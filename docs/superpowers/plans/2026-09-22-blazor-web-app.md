# Blazor Web App migration

Goal: Deliver landing/tool descriptions as HTML on the first response, while
retaining all document operations in browser-only Interactive WebAssembly.

Architecture: New SabuySign.Host ASP.NET Core host references the existing
SabuySign.Web client assembly. Root routing and metadata use Static SSR; ready
tools are prerendered WASM islands. Public navigation/filtering uses small JS.
Nginx proxies HTML/assets to Host and encrypted pairing requests to Relay.
No Interactive Server/Auto registration or document upload endpoint.

- [x] Add host, static routes, metadata, configured canonical origin, sitemap,
  robots, real 404 and legacy merge redirect. Use a per-request CSP nonce.
- [x] Convert existing standalone startup to a client entry point; render ready
  tools as WASM islands. Retain browser-only JS initialization and native
  navigation with beforeunload protection. Make public navigation work in SSR.
- [x] Update Docker Compose, nginx, local dev configuration and documentation.
- [x] Verify raw HTML and JS-disabled views, no WASM on landing, client execution
  for tools, CSP and HTTP behavior. Run existing browser and unit regressions,
  format and build checks. Inspect visual output.

Production origin is configured with PublicOrigin; localhost is the development
default. No public deployment is included. No PostgreSQL schema changes.

## Verification (2026-09-22)

- Release host build and Docker publish succeeded.
- Node unit tests: 30 passed. Relay tests: 3 passed.
- Docker browser regression suite: 12 passed on the initial full run; the two
  storage assertions were updated to allow only Blazor's validated runtime hash,
  then both passed in a focused rerun (14 scenarios verified overall).
- SEO coverage verifies first-response HTML, JavaScript-disabled content,
  canonical metadata, sitemap, robots, real 404, merge redirect and CSP nonce.
- Landing navigation/filtering does not load the WASM runtime; tools start WASM
  without an Interactive Server connection. Existing PDF and QR flows pass.
- TypeScript checking, Prettier verification and dotnet format verification pass.
- Landing screenshot inspected; existing layout is retained.

Deployment still requires PUBLIC_ORIGIN to be set to the real HTTPS domain.
Search engine indexing/ranking and a public deployment were not tested.
