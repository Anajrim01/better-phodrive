# Library page fixture

Captured on 2026-10-31 from the 1,078-item sample account (email redacted). The first page held 364 items. All 364 carried field 2.4, 363 contained the `.phodrive-` marker, 358 matched `name.ext.phodrive-<64hex>-<i>-of-<n>.bmp`, and 6 values were non-ASCII names. 353 items were visible in the library.

The fixture keeps 5 visible items, 4 marker names and 1 ordinary name. The real non-marker item was not visible in the captured page, so it could not exercise the listing filter. One marker name is a sanitized replacement with an ordinary name so the page-level filter has both cases.

Every printable identifier was replaced with a same-length fake: media keys, URLs, account IDs, the Android package name, and file names. Timestamps and payload sizes were replaced with same-length values. Field numbers, wire types, nesting and lengths are unchanged. No original names, tokens, media keys, account IDs, URLs or timestamps remain.
