# Library discovery requests

## Scope

This note covers the current integration architecture: the listing parser in
`core/src/server/photos/library/metadata.ts`, the probe in `probe.ts`, and the
PostgreSQL `chunk_metadata` index. It does not describe the old fork's probe cache,
delta state, or compression format.

## Request path

A library page lists stored media items. For each candidate the scan checks the
scoped metadata index. A row is reused only when the current listing reports the
same stored SHA-1 and stored BMP size. On a miss the scan calls PrepareDownload,
reads the first 64 KiB of the stored BMP, validates the header, and saves a row.

## What the listing proves

| Field              | Listing        | Index row    | BMP header   |
| ------------------ | -------------- | ------------ | ------------ |
| `mediaKey`         | yes            | lookup key   | no           |
| stored SHA-1       | yes            | match key    | no           |
| stored BMP size    | yes            | match key    | redundant    |
| `at`               | yes            | no           | no           |
| `trashed`          | yes            | no           | no           |
| `accountId`        | server session | yes          | no           |
| `fileHash`         | no             | yes          | yes          |
| `fileId`           | no             | yes          | yes          |
| `chunkIndex`       | no             | yes          | yes          |
| `isLast`           | no             | yes          | yes          |
| payload size       | no             | yes          | yes          |
| `originalName`     | no             | chunk 0 only | chunk 0 only |
| `folder`           | no             | chunk 0 only | chunk 0 only |
| chunk count        | no             | no           | no           |
| original file size | no             | no           | no           |

The listing SHA-1 is the SHA-1 of the full stored BMP, including its header,
payload, and padding. It is not the original file hash. `fileHash` is a separate
SHA-256 inside the BMP header.

Chunk count is not stored anywhere. `groupChunks` derives it from the last chunk's
`chunkIndex`, and reports the file incomplete when that chunk is missing.
`originalName` and `folder` exist only in chunk 0. A v2 folder is never copied to
later chunks.

The Google Photos display name is not used. A user can rename an item, the name is
not covered by the fingerprint, and the fixtures already contain renamed chunks
whose header name differs from the listing name.

## The size check

Every stored split BMP is `54 + 3 * width * height` bytes, and the encoder rounds
`width` up to a multiple of 4. So every total is `54 + 12k`, and the smallest
possible total is `54 + 3 * 32 * 32 = 3126` bytes. The probe decoder already requires
this layout. `isPossibleSplitBmpSize` applies the same necessary condition to the
listing size, so it cannot reject an item the probe decoder would accept.

The filter does not use the encoder's 200 MB upload cap. The probe decoder has no
such cap, so the listing filter must not add one. The cap stays an upload and
download limit.

Most ordinary photos and videos fail this check and are dropped during parsing,
before PrepareDownload. The check does not prove an item is Phodrive. Items that
pass it still need a probe.

## Identical stored copies

Two candidates with the same listing SHA-1 and stored BMP size share the app's
stored-object identity. The metadata index and the download integrity check use the
same SHA-1 contract, so under that contract every header field is identical. A
SHA-1 collision between two stored BMPs of the same size would break the reuse. The
app already accepts that risk when it deduplicates uploads and verifies chunk
downloads.

`scanLibraryPage` probes one representative per page and rebuilds the other copies
with their own media key, timestamp, and trash state. It also reuses a loaded row
for a matching cold media key and saves a row for each copy.

This reuse needs no cache and no persistence of its own. It is limited to one page
because the scan keeps no state between pages. Copies on separate pages probe once
per page; later scans hit their saved rows.

## What still needs BMP bytes

- A unique cold chunk has no matching bytes anywhere, so it needs one probe.
- Every chunk of a multi-chunk file has different bytes, so a file with N chunks
  needs N probes.
- A cold chunk's `fileId`, `isLast`, payload size, name, and folder live only in its
  header.
- A foldered file's folder lives only in chunk 0. Chunks 1 and later cannot prove it.

No safe cross-chunk shortcut exists in the current format. The chunks share no
authenticated file record, and the name marker is not covered by the fingerprint.

## Measured budget

Probe counts are PrepareDownload plus range GET. The index counts are candidates
with a matching row on their first scan, followed by candidates that needed a probe.
Every single-page `listBmps` call adds one auth POST and one library POST. A two-page
enumeration adds two auth POSTs and three library POSTs because the first page also
fetches the next page as a lookahead.

| Case                                       | Auth | Library | Prepare | Range | Index hit / miss | Before Prepare + Range |
| ------------------------------------------ | ---: | ------: | ------: | ----: | ---------------: | ---------------------: |
| One cold root single-chunk file            |    1 |       1 |       1 |     1 |            0 / 1 |                  1 + 1 |
| One cold foldered single-chunk file        |    1 |       1 |       1 |     1 |            0 / 1 |                  1 + 1 |
| One cold root 3-chunk file                 |    1 |       1 |       3 |     3 |            0 / 3 |                  3 + 3 |
| One cold foldered 3-chunk file             |    1 |       1 |       3 |     3 |            0 / 3 |                  3 + 3 |
| 100 unique cold candidates, 2 pages        |    2 |       3 |     100 |   100 |          0 / 100 |              100 + 100 |
| Repeat scan with a complete index          |    2 |       3 |       0 |     0 |          100 / 0 |                  0 + 0 |
| One stale row among 10 indexed candidates  |    1 |       1 |       1 |     1 |            9 / 1 |                  1 + 1 |
| 10 indexed and 5 cold candidates           |    1 |       1 |       5 |     5 |           10 / 5 |                  5 + 5 |
| 12 ordinary photos, 11 impossible sizes    |    1 |       1 |       1 |     1 |            0 / 1 |                12 + 12 |
| One ordinary video with an impossible size |    1 |       1 |       0 |     0 |            0 / 0 |                  1 + 0 |
| Three identical cold copies                |    1 |       1 |       1 |     1 |            0 / 3 |                  3 + 3 |
| One indexed and one identical cold copy    |    1 |       1 |       0 |     0 |            1 / 1 |                  1 + 1 |

The 100-candidate cold scan probes 60 items on the first page and 40 during its
lookahead. The second call hits those 40 saved rows and makes no probes. The repeat
scan loads the same pages and makes no probes.

The tests in `core/tests/server/library-request-budget.test.ts`,
`core/tests/server/library-ordinary-budget.test.ts`, and
`core/tests/server/library-content-reuse.test.ts` pin these counts.

## Rejected changes

- Listing name inference. The name is display metadata and can change. It cannot
  prove membership, `fileId`, folder, or payload size.
- Cross-chunk representative probing. Copying chunk 0's fields to its siblings would
  merge files that the stored bytes keep separate.
- A sidecar index item. It adds a second source of truth on Google Photos, upload
  ordering, and backfill work. The current format does not need it.
- A negative cache for ordinary items. The size check already removes most of them
  without durable state.
- An in-memory or persisted probe cache. It duplicates the PostgreSQL index and
  brings back the invalidation problems that index already solves.
- A content-keyed database lookup. It is safe for identical bytes, but it needs a
  new index and remove/refcount work for a rare case. The per-page reuse covers the
  common copy case.
- Auth caching. One auth POST per page call is real, but it belongs to pagination
  and auth work, not cold-probe work.

## Refresh

`readLibrarySnapshot` reloads the pages already loaded. With a complete index, each
page costs one auth POST, one library POST, and sometimes one lookahead library
POST, with no probes. The refresh budget scales with the number of loaded pages, not
with the library size.
