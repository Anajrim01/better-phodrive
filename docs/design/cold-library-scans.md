# Cold library scan probes

Issue #60 asks whether a cold library scan can avoid probing every unique Phodrive
chunk. This note records the field requirements, the rejected lazy representation,
the measured request budget, and the smallest optional index change that would make
future scans cheap.

## Current probe path

A cold scan reads one library page, then for each unique stored chunk it calls
`preparedDownloadUrl` and fetches the first `MAX_SPLIT_HEADER_BYTES` with a range GET.
The decoder reads only the split header. The scan does not fetch the chunk payload.

The scan already reuses a probe when two media items have the same stored bytes, which
means the same listing `(sha1, size)`. That reuse is safe and is covered by #71 and
#72. Every other chunk is unique and gets its own `PrepareDownload` plus range GET.

## What each source can prove

| Source           | Fields                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google listing   | `mediaKey`, stored `sha1`, stored BMP `size`, `at`, optional file name, trashed state                                                                  |
| Chunk file name  | original name, `fileHash`, `chunkIndex`, `chunkCount`                                                                                                  |
| BMP split header | `fileHash`, `fileId`, `chunkIndex`, `isLast`, `originalName` on chunk 0, `folder` on chunk 0, `compressed`, stored payload size, original payload size |
| Local state      | resolved `RemoteBmp` rows, overrides, `trashedAt`, sync token, revision log                                                                            |

The listing `size` is the stored BMP length. It is not the original file length.
The file name marker does not contain `fileId`, `folder`, compression flags, stored
payload size, or original payload size.

## Required fields by operation

| Operation                       | Required fields                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library discovery and grouping  | listing `mediaKey`, `sha1`, `at`; header `fileHash`, `fileId`, `chunkIndex`, `isLast`, `originalName`, `folder`; name marker `chunkCount`                                                      |
| Folder navigation               | grouped `fileId`, `originalName`, `folder`, `chunkCount`, `isLast`                                                                                                                             |
| Trash state                     | listing `mediaKey`, `sha1`, `trashedAt`; grouped `fileId`, `originalName`, `folder`; resolved rows from local state or the probe cache                                                         |
| Download                        | `fileId`, `fileHash`, `name`, every chunk `mediaKey`, `sha1`, `chunkIndex`, `isLast`, `originalName` on chunk 0, `folder` on chunk 0, `compressed`, stored payload size, original payload size |
| Preview                         | the same fields as download for the chunks it reads; preview validates the full chunk list before opening chunk 0                                                                              |
| Move and rename                 | grouped `fileId`, `originalName`, `folder`, plus all resolved rows written back to local state                                                                                                 |
| Delete, restore, delete forever | `fileId`, `fileHash`, name, every chunk `mediaKey`, `sha1`, `trashedAt`, plus the header fields that identify the stored chunk                                                                 |
| Incremental sync                | persisted resolved `RemoteBmp` rows keyed by `mediaKey`; delta items use the same fields as discovery                                                                                          |

`fileId` is the grouping key. It is a hash of the original name, `fileHash`, the
chunk payload constant, and the folder. Legacy uploads used a different payload
constant and identity input, so recomputing a legacy `fileId` from the current inputs
is not safe.

## Rejected lazy representation

A deferred row could hold only what the listing and file name prove:

```text
mediaKey, sha1, listing size, at, trashed,
originalName, fileHash, chunkIndex, chunkCount
```

That row has no trustworthy `fileId`, `folder`, `compressed`, stored size, or original
size. The following ways to turn it into logical files all break an invariant:

1. Group by `mediaKey`. Each chunk becomes its own file, so this is not a logical file
   view.
2. Group by the file name key `(originalName, fileHash, chunkIndex, chunkCount)`.
   This merges two files with the same name and hash in different folders.
3. Probe only chunk 0 and copy its `fileId` and `folder` to the other chunks. The
   other chunks do not contain that folder, and a forged file name marker can point at
   a chunk whose header has a different `fileId`. This is sibling inference, not proof
   from stored bytes.
4. Copy compression or sizes from chunk 0 to the other chunks. One file can mix raw
   and compressed chunks, and each chunk has its own stored and original size.

The format has no stored relation between a chunk 0 header and the other chunks other
than the file name marker. The marker is not authenticated and does not contain
`fileId` or `folder`. The only safe relation is exact stored bytes, which the scan
already uses.

The cold scan tests pin these cases:

- two files with the same name and file hash in different folders stay separate;
- chunks of one file keep different compression states and sizes;
- the same name and file hash with different header `fileId` values stays separate;
- a download after a cold scan uses every resolved chunk header;
- an incremental sync after a cold scan does not re-probe unchanged chunks;
- a restart with persisted resolved metadata does not probe again.

## Measured request budget

Each row counts `auth + library page + delta + PrepareDownload + range GET` requests.
The budget tests in `core/tests/server/library-request-budget.test.ts` and
`core/tests/server/library-request-budget-multi.test.ts` assert these counts. The
boundary tests live in `core/tests/server/library-cold-scan-identity.test.ts`,
`core/tests/server/library-cold-scan-compression.test.ts`, and
`core/tests/server/library-cold-scan-sync.test.ts`.

| Scenario                                  | Auth | Pages | Delta | PrepareDownload | Range GET |  Total |
| ----------------------------------------- | ---: | ----: | ----: | --------------: | --------: | -----: |
| 5,000 unique one-chunk files              |    1 |    25 |     0 |           5,000 |     5,000 | 10,026 |
| One 5,000-chunk file                      |    1 |    25 |     0 |           5,000 |     5,000 | 10,026 |
| 500 files of 10 chunks                    |    1 |    25 |     0 |           5,000 |     5,000 | 10,026 |
| Same name and hash in two folders         |    1 |     1 |     0 |               2 |         2 |      6 |
| Duplicate folder and name, same bytes     |    1 |     1 |     0 |               1 |         1 |      4 |
| 5,000 identical stored copies             |    1 |    25 |     0 |               1 |         1 |     28 |
| Warm list in the same process             |    0 |     1 |     0 |               0 |         0 |      1 |
| Restart with persisted state, quiet delta |    0 |     0 |     1 |               0 |         0 |      1 |

A warm restart does not re-probe because the
library state stores the resolved rows and `RemoteBmpSchema` validates them on load.

The first three rows are the same budget because every chunk has different stored
bytes. Unique chunk count, not file count, sets the probe cost.

## Smallest future index change

The smallest optional change that removes the per-chunk probe cost for multi-chunk
files is a per-file index sidecar:

- Name: `<fileHash>.phodrive-index-<fileId>.bmp`
- Header: the existing BMP prefix, then a distinct `BMIDX` magic and version. The
  old split decoder rejects it and the old probe caches it as a non-Phodrive item.
- Payload: `fileId`, `fileHash`, original name, folder, chunk count, and one record per
  chunk: index, listing `sha1`, flags, stored payload size, original payload size.
- Upload: write the sidecar after the last chunk, when every chunk `sha1` is known.
- Scan: recognize the sidecar before the normal probe. Probe each sidecar once, then
  match its records to listing items by the recorded `sha1`. A record is used only
  when the sidecar header and file name agree and every matched listing item has the
  recorded stored bytes. Unmatched, missing, or invalid chunks fall back to the
  current per-chunk probe.
- Ordering: a sidecar can appear after its chunks, so a full scan needs a first pass
  over the pages or a sidecar cache keyed by `fileHash` and `fileId`. The first scan
  that sees a sidecar may still probe chunks that arrived earlier; later scans reuse
  the cached sidecar.
- Actions: downloads, previews, and destructive actions still fetch and validate each
  chunk header before using it. The sidecar only avoids discovery probes.

Legacy files have no sidecar and keep the current behavior. A sidecar can be added
later by a one-time backfill, but the backfill itself costs the same probes as today.

This change reduces a 5,000-chunk file to one sidecar probe. It does not remove the
single probe for a one-chunk file, because that file has no sibling chunks to amortize
the index. Removing the one-chunk cost requires either a single account-level index
item or enough metadata in the file name to group without a probe. Both are larger
changes, and an account-level index adds a second source of truth that must be updated
on every upload, move, trash, restore, and permanent delete. This slice does not add
either runtime change.
