# PDF date tool

User approved adding dates using UI UX Pro Max after the editor release.
Bounded design: calendar toolbar action, right inspector on desktop and bottom
inspector on mobile. Local today defaults to Buddhist numeric output; select a
civil date, Gregorian/Buddhist year, numeric/Thai short/Thai full month format.
Show the final date before placement. Reuse current text size. Click to place;
select to edit date settings, drag existing handle to move, delete and undo.

Date metadata and rendered text are stored together in session history. Dates
are frozen at placement, never refreshed by the clock. Input is a Gregorian
civil date and is not parsed through UTC. Shared font shaping/PDF export keeps
Thai date text editable through the date inspector and searchable in the PDF.
No external service, document upload, persistent storage or new dependency.

UI UX Pro Max guidance used: visible input labels, locale-specific date formats,
visible focus indicators and 44px controls. Desktop and 390px screenshots are in
ignored artifacts/date-*.png. Unit checks cover leap years, invalid dates, both
year systems, metadata/history and PDF text extraction. Browser checks cover
placement, editing, deletion/undo and preview/download at both viewport sizes.
