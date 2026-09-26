# Password-protected PDF in Fill & Sign

- Files up to the editor's existing 25 MB / 100-page limits are supported.
- On the encrypted-file error from pinned pdf-lib, show a password dialog.
  Wrong passwords can be retried; Cancel/Escape preserves an existing editor
  document or returns to the upload screen. Inputs are not persisted.
- QPDF 12.2.0 compiled to WebAssembly decrypts locally in a short-lived worker.
  Passwords, QPDF diagnostics and PDFs are never sent to an API or telemetry.
  Ordinary PDFs do not load QPDF. Timeout is 60 seconds per attempt.
- RC4 and AES-128/AES-256 have fixture coverage. Certificate/DRM protection is
  not supported. Editing restrictions require successful owner authentication.
- The app then validates the decrypted PDF through its existing pipeline,
  including size/page constraints and rejecting digital signature dictionaries.
- Pages remain native PDF content. Thai text and signatures are added through
  the existing export path, not by flattening each page into a bitmap.
- Exported PDFs are unencrypted. The password dialog and download preview both
  disclose this; the original file on disk is unchanged. Re-encryption is not
  part of this feature.

Verification: tests/password-pdf.test.ts covers encryption variants, wrong and
owner passwords, modification restrictions and unchanged input. Browser tests
cover retry, show/hide password, cancellation/reselection, mobile layout, no
network writes, native PDF export and searchable Thai text.
