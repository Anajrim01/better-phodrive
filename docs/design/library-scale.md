# Library scale options

A 1,078-item library made two Google calls per item on every refresh: one prepare-download and one ranged read for the split header. That traffic hit HTTP 429. The probe cache and the request breaker address the repeated cost. This note records the larger options and why they are deferred.

## Sharding across accounts (D)

Sharding stays deferred. Every listed file would depend on the account that owns it, and Google's limits may apply per IP, not only per account. The work is large.

Files would be assigned to an account pool at upload time and the owner tag would live in the split header so any browser can read it. Listing would merge every account, each with its own concurrency pool and breaker, and downloads would route to the owner. A file's chunks would never split across accounts.

The cost is one listing pass per account on every refresh, which multiplies the problem this change set fixes, plus account chips and per-account stats in the UI. It only pays off after the probe cost is near zero.

## Packing small files (E)

Packing stays deferred. One trashed pack would lose every file inside it. The work is large.

A pack would hold many small files plus a table of contents in its first 64 KB, so metadata and one member download each cost a prepare and a ranged read. Packs must be immutable, the table of contents must fit in 64 KB, and member hashes keep dedupe working.

The workload here averaged about 111 MB per file, so packing saves nothing. It only helps libraries made of many small files, and it needs a format version, a pack builder, and a repair path for a damaged table of contents.

## Manifest item (F)

The manifest stays deferred. It would become a second source of truth and go stale after deletes or failed commits. The work is large.

One Google Photos item would list names, hashes, chunk keys, sizes, timestamps and folders. Listing becomes one read instead of two calls per item, and a fresh browser sees folders and stats with no local state. Downloads already take a media key and SHA-1, so a manifest entry is enough.

Discovery is the first problem. A fresh client cannot find the manifest without a probe pass or a stored hint. Writes cannot be atomic, so the design needs an append-only journal of small index segments, one per upload batch, read newest to oldest with a depth cap and periodic compaction. Every segment is another Google Photos item to ingest, and every download must still check the SHA-1 Google returns. A manifest miss has to fall back to a probe rather than hide a file.

It duplicates what the probe cache already does for repeat refreshes and only adds value for a cross-device folder listing. The live experiment confirmed that library metadata carries the file name, so the name-based listing is implemented and the manifest has no remaining read benefit for this client.
