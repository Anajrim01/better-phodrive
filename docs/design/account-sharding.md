# Account groups

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

Compression is the other lever: it reduces the bytes that count against an
account's upload budget. The two changes are complementary, not alternatives.

## What a group is

A group is a named list of accounts the person has already connected. Groups are
local to the machine: the browser keeps them with the other preferences, and the
CLI keeps them in `config.json`.

A group stores account emails only. Tokens stay in the existing account store,
so replacing a token does not rewrite every group, and a group never becomes a
second credential store. The group schema holds an id, a name, and a nonempty
list of unique emails. Stored data that is absent, malformed, or duplicated is
dropped on read, so an older config without groups loads as an empty list.

Groups are optional and off by default. With no group selected, every path
behaves as it does today: one selected account, one queue, one listing.

## Assignment

When an upload starts with a group, the client assigns each file to one member
and keeps that owner for the whole upload.

- The owner covers the file and all of its chunks: hash lookup, upload start,
  transfer, commit, retries, downloads, and deletes.
- Assignment is weighted by bytes. Files are placed largest first, each on the
  member with the fewest assigned bytes. When two members have equal loads, the
  earlier member in the group wins. File order does not change the result.
- A paused member takes no new files. The remaining members continue.
- If every member is paused, files wait. They are never moved to an account
  outside the group, because a split file on two accounts cannot be listed or
  downloaded as one object.
- A file is never split across accounts, and a half-uploaded file never resumes
  on another account.

The owner is the account that holds the chunks. Local state records it next to
the `fileId`, so a retry does not depend on reading the first chunk again. The
split header needs no owner field: listing already reports which account returned
each chunk, and that account is the owner.

## Per-account scheduling

Each account keeps its own:

- upload queue, so a paused account blocks only its own files;
- request token bucket and byte budget, because the research suggests separate
  request and volume budgets;
- circuit breaker, so one account's pause is not a global pause;
- auth cache entry, keyed by email and token;
- probe cache namespace, which already includes the email.

The queue assigns whole files. With one account, behavior is unchanged. With
several, a file waits for its owner instead of moving to another account.

## Listing

The client lists each group member and merges the pages into one result.

- Every item carries its owner's email.
- The merge key is media key plus chunk index, so a repeated item within one
  account or across accounts appears once.
- Two accounts that hold the same file return different media keys, so the merge
  keeps both rows. The group view groups those rows by file id and chunk index
  and lists every owner that holds the file. That grouping belongs to the group
  view, not to the phase 1 merge helper.
- A member that answers contributes its items. A member that is paused or
  skipped contributes a per-account state with its retry window, and the result
  is marked partial. Partial results are never presented as the complete
  library, because files missing from a paused account would look deleted.
- The merged list sorts newest first, then by owner email, file id, chunk index,
  and media key, so the order does not depend on which request finished first.
  The view's chosen sort re-sorts the merged list.

The cost is one listing pass per account. That multiplies the probe traffic this
workstream is trying to reduce, so groups should land after the probe cache and
metadata work, not before. A manifest item would reduce the cost but is a second
source of truth and stays deferred.

## Downloads and deletes

The owner routes every file request: prepare-download, the ranged header probe,
the real download, and the delete.

- A paused owner makes the file temporarily unavailable. There is no fallback
  account.
- A delete removes only the owner's chunks.
- A file held by two owners is deleted from each owner in turn. A delete never
  removes a chunk from an account that does not own it.
- A file whose owner left the group stays unavailable until that account is added
  back. The client never guesses an owner.
- Routing resolves the owner's token from the account store. A route that cannot
  find the owner reports which account is missing.

## Removing an account

Removing an account from a group that holds files warns and migrates nothing.
The files stay on that account. Removing the account from the machine leaves
those files unavailable. A re-upload is a new upload, not a move: it writes new
chunks and does not touch the originals. A group always names at least one
account, so removing the last one deletes the group.

## Albums and folders

A Google album cannot span accounts. A folder therefore maps to one album per
owning account plus the local folder entry, and the existing
`albums[email][folder]` shape already models that. Group membership does not
change album assignment.

## Failure cases to test

- One member is paused during a listing: the result is partial, other members
  still list, and the paused member carries a retry window.
- Two accounts return the same media key: it merges once per chunk index.
- The owner is paused: download and delete report `OWNER_PAUSED` and name that
  account, with no request to another member.
- Every member is paused: the assignment leaves files unassigned.
- File sizes are very uneven: byte totals stay close without splitting a file.
- The owner was removed from the group: routing reports `OWNER_NOT_IN_GROUP`.
- Two accounts share one IP and one receives heavy traffic: the other stays
  clean. This is the independence test under an active throttle, which the
  research could not run.

## Phase 1 scope

Contained:

- the group schema and its stored-data migration;
- deterministic, size-weighted file assignment with per-member availability;
- the merged listing helper with per-account state and deduplication;
- owner routing helpers for download and delete;
- this design.

Not contained here:

- any UI for creating groups or picking one for an upload;
- the group view's cross-account grouping by file id and chunk index;
- CLI commands for groups;
- wiring the group into upload, refresh, download, and delete;
- an owner field in the split header;
- album migration, rebalancing, or moving existing files.

Phase 1 changes no single-account behavior. Every new field defaults to empty,
and the existing paths keep using the selected account.
