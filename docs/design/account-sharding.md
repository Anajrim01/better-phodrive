# Account sharding

## Why

The 429s in production are most likely per account, with separate budgets per
endpoint group, not per IP or caller signature. Every private Photos RPC carries only a
bearer token, which belongs to one Google account; the caller package and
signature appear only when the token is issued. A read-only probe of 463
requests across two accounts on one IP and one signature produced no 429s, so a
low shared IP bucket is excluded. The upload failures fit a byte or new-media
budget better than a request-rate limit, because the run stopped near 14.4 GB
and retries after a backoff kept failing.

One account is therefore the useful shard. Adding accounts raises the aggregate
request rate and the aggregate upload byte budget until a much higher shared
ceiling or the client's own CPU and bandwidth becomes the limit. Sharding by
caller identity would not help and would put the accounts at risk.

Phase 1 compression is the other lever: it reduces the bytes that count against
an account's upload budget. The two changes are complementary, not
alternatives.

## Ownership

The server assigns each file to one account when it accepts the file for upload. Every chunk
of that file uses the same account for its hash lookup, upload start, transfer,
commit, retries, downloads, and deletes. Chunks are never split across accounts
and a half-uploaded file is never resumed on another account.

The client stores the owner in two places:

- The first chunk's split header carries the owner account. Later chunks point
  at the same owner through their `fileId` group, so the header does not need to
  repeat the address in every chunk.
- Local state records the owner alongside the `fileId`, so a retry does not
  depend on reading the first chunk again.

The owner is an immutable account identifier, not a mutable display name. Use
the account's email if the stored account list is the source of truth; the
design should not invent a second identity that can drift. A chunk whose header
owner does not match the account it was found under is corrupt and should be
hidden, not guessed.

The split header already carries a flags bitfield and an optional original-size
varint. Owner metadata belongs after the folder field on the first chunk, as a
length-prefixed UTF-8 email or as a short stable id from local state. It must
stay inside the existing 64 KiB header limit. Version 1 chunks have no owner and
remain owned by whichever account currently lists them; they must keep
decoding, so the owner field is optional.

## Scheduling

Each account gets its own:

- upload queue, so a paused account blocks only its own files;
- request token bucket and byte budget, because the research suggests separate
  request and volume budgets;
- circuit breaker, replacing the current email-keyed breaker only in the sense
  that it already is per email; the change is to stop treating one account's
  pause as a global pause;
- auth cache entry, keyed by email and token, which the current cache already
  supports;
- probe cache namespace, which already includes the email.

The pool assigns whole files. It picks the account with capacity and does not
round-robin individual chunks. With one account the behaviour is unchanged.
With several, a file waits for its owner rather than moving to another
account. That wait is a correctness rule, not a preference: a split file on two
accounts cannot be listed or downloaded as one object.

The browser still sends one upload request per chunk. The server decides which
account receives it, or the browser attaches the chosen owner to the request.
Either way the owner decision must be idempotent for retries: the same `fileId`
and chunk index always resolve to the same account.

## Listing

Listing queries every account and merges the results. Each account has its own
pagination token, its own probe cache, and its own concurrency limit. The merge
key is the existing `(email, fileId)` pair, with chunk index completing the
group. Because the owner is part of the key, two accounts that deduplicate the
same SHA-1 remain separate files until a deliberate cross-account policy says
otherwise.

If one account is throttled, the refresh returns the chunks from the accounts
that answered plus a per-account status. It must not fail the whole refresh
because one account paused. The response carries, per account, either `ok` or
`retryAfterSeconds`, so the next refresh can retry only the paused account.
Partial results must be labelled as partial; silently presenting them as the
complete library would make files appear deleted.

The cost is one listing pass per account. That multiplies the probe traffic this
workstream is trying to reduce, so sharding should land after the probe cache
and metadata work, not before. A manifest item would reduce the cost but is a
second source of truth and stays deferred.

## Downloads and deletes

The merged record carries the owner. Prepare-download, the ranged header probe,
and the real download all go to that account. A throttled owner means the file
is temporarily unavailable; there is no fallback account. A delete follows the
same route and removes only the owned chunks.

Routing is visible to the client: the file request needs the owner account's
token. That is a wire-format change to `FileRequest`, and the browser must store
the owner with each chunk it accepts from an upload.

## Upload retries and deduplication

- Retry a throttled chunk on its owner after that account's advertised or
  backoff window.
- Do not migrate the chunk.
- When a commit outcome is uncertain, re-check by SHA-1 on the owner only.
- Deduplicate within the owner first. The same SHA-1 may legitimately exist on
  two accounts. Cross-account deduplication is a policy choice, not an
  invariant.

The phase 1 change still applies: the SHA-1 that is looked up and committed is
the hash of the bytes actually uploaded, after compression. A retry of the same
raw chunk compresses deterministically, so the owner's lookup still finds the
earlier transfer.

## Albums, folders, and account removal

A Google album cannot span accounts. Folder albums therefore become one album
per owning account plus a local virtual folder, or the UI accepts that one
folder maps to several albums. The existing `albums[email][folder]` shape
already models this.

Removing an account that owns files must not silently orphan them. Block the
removal, or offer an explicit re-upload or migration, which is a new upload and
not a move. Files owned by the removed account must remain visible as
unavailable until the user resolves them.

## API and UI impact

This design reaches the UI, so implementation stops for review before code.

- The library response needs per-account status, not one global 429.
- The browser needs the owner on each file group and in each file request.
- A paused account needs a visible state: the account chip or upload panel must
  say which account is paused and for how long. A single global banner would
  misreport a partial library.
- File actions need to explain "owned by a paused account" without pretending
  the file is missing.
- Folder albums may show one folder with several backing albums.

None of that should ship as a hidden server-only change, because the current UI
cannot represent a partial library or a file that is temporarily unaddressable.

## Failure cases to test

- One account 429s mid-refresh: the response is partial, other accounts still
  list, and the paused account carries a retry window.
- One account is removed: owned files stay addressable or the UI refuses the
  removal.
- A commit fails uncertainly: no duplicate is written to another account, the
  retry stays on the owner, and the SHA-1 lookup resolves it.
- A file is uploaded while its owner is paused: it waits, and its chunks never
  appear on another account.
- Two accounts share one IP and one receives heavy traffic: the other stays clean. This is
  the independence test under an active throttle, which the research could not
  run.
- A first chunk has a missing or mismatched owner field: the group is hidden or
  flagged, never reassigned.

## Scope decision

Contained parts, if this is approved:

- server-side owner assignment and routing;
- per-account queue, breaker, auth cache, and probe cache;
- owner field in the split header and in local state;
- merged listing with partial results.

Not contained:

- per-account UI, account chips, pause copy, and file-request wire changes;
- album migration or account removal policy;
- rebalancing existing files.

Because the UI and the file-request format change, this phase is a design
deliverable only until the owner reviews it.

## Usage insights (phase 3 proposal)

A quota bar stays out: storage is unlimited for the spoofed Pixel, so a bar
would invent a limit. Two cheap alternatives fall out of the existing stats:

- **Stored versus logical bytes.** Phase 1 makes the two differ. The library
  already reports each chunk's original size; the probe also knows its stored
  size. Showing "2.4 GB stored, 8.1 GB logical" is honest and needs no new
  history.
- **Largest files.** Already derivable from grouped chunks and useful for
  finding what dominates an account's budget.

Growth over time needs retained snapshots that the current client does not
keep. It would be a new local time series and should not be built until the
largest-files view proves insufficient.
