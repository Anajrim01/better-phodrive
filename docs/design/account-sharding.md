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
client-local: the browser keeps them with the other preferences, and the CLI
keeps them in `config.json`.

A group stores account emails only. Tokens stay in the existing account store,
so replacing a token does not rewrite every group, and a group never becomes a
second credential store. The group schema holds an id, a name, and a nonempty
list of unique emails. Stored data that is absent or malformed is ignored on
read. The stored shape is draft and has no compatibility promise.

Groups are optional and off by default. With no group selected, every path uses
the selected account: one queue, one listing.

## Assignment

When an upload starts with a group, the client assigns each file to one member
and keeps that owner for the whole upload.

- The owner covers the file and all of its chunks: hash lookup, upload start,
  transfer, commit, retries, downloads, and trash actions.
- Assignment is weighted by bytes. Files are placed largest first, each on the
  member with the fewest assigned bytes. When two members have equal loads, the
  earlier member in the group wins. File order does not change the result.
- A paused member takes no new files. The remaining members continue.
- If every member is paused, files wait. They are never moved to an account
  outside the group, because a split file on two accounts cannot be listed or
  downloaded as one object.
- A file is never split across accounts, and a half-uploaded file never resumes
  on another account.
- A retry stays on the recorded owner. If that owner is paused, the file waits
  with a visible message instead of being reassigned.

The owner is the account that holds the chunks. During an upload the in-memory
job keeps the owner next to the `fileId`, so a retry does not depend on reading
the first chunk again. After a reload, the merged listing supplies the owner. The
split header needs no owner field: listing already reports which account returned
each chunk, and that account is the owner.

## Per-account scheduling

Each account keeps its own:

- upload queue, so a paused account blocks only its own files;
- circuit breaker and pause deadline, so one account's pause is not a global
  pause;
- auth cache entry, keyed by email and token;
- probe cache namespace, which already includes the email.

The queue assigns whole files. With one account, the group behaves like the
selected account. With several, a file waits for its owner instead of moving to
another account. The worker setting applies to each account, so a group of three
can run up to three times the configured worker count.

## Listing

The client lists each group member and merges the pages into one result.

- Every item carries its owner's email.
- The merge key is media key plus chunk index, so a repeated item within one
  account or across accounts appears once.
- Two accounts that hold the same file return different media keys, so the merge
  keeps both rows. Cross-account grouping by file id and chunk index is not
  implemented; each row is a separate file.
- A member that answers contributes its items. A member that is paused or
  skipped contributes no items to a full listing, plus a per-account state with
  its retry window, and the result is marked partial. An incremental refresh
  keeps that member's previously loaded items, so they stay visible. The partial
  state tells the view why, so the files are not reported as deleted.
- Hidden trashed chunks belong to the member's listing and carry a trash mark.
  After the merge, grouping splits fully trashed files into Trash; a partly
  trashed file stays in the main list with an incomplete warning.
- A member status is unknown until a listing or an upload observes it. Paused
  carries a deadline. A listing that returns ok clears the pause only after
  that deadline, and automatic refresh skips members inside their window
  instead of querying them again.
- A group account with no saved token is reported as not connected, and the
  group still lists the connected members.
- The merged list sorts newest first, then by owner email, file id, chunk index,
  and media key, so the order does not depend on which request finished first.
  The view's chosen sort re-sorts the merged list.

Each group member costs one listing pass per refresh; the probe cache and delta
sync keep repeat passes cheap. A manifest item would reduce the cost but is a
second source of truth and stays deferred.

## Downloads and trash

The owner routes every file request: prepare-download, the ranged header probe,
the real download, and every trash action (move to trash, restore, delete
forever).

- When the client already knows a file's owner, routing reports
  `OWNER_PAUSED` for a paused owner and never falls back to another account.
  A merged listing alone cannot target a paused owner's files because that
  member contributed no items; the partial state covers that case.
- A trash action affects only the owner's chunks.
- Each owner's copy is a separate row. Trashing a file affects only that owner's
  chunks; trash each row to move every copy. A trash action never touches an
  account that does not own the chunk.
- Phodrive never restores a file automatically and stores no tombstone. Restore
  clears the trash mark on the owner's chunks; Delete forever drops them from
  the local index.
- A permanent deletion made outside Phodrive drops the chunk on the next delta,
  so the remaining chunks group into an incomplete file with a missing-chunk
  warning.
- A file whose owner left the group stays unavailable until that account is added
  back. The client never guesses an owner.
- Routing resolves the owner's token from the account store. A route that cannot
  find the owner reports which account is missing.

## Removing an account

Removing an account from a group that holds files warns and migrates nothing.
The files stay on that account. Removing the account from the machine leaves
those files unavailable. A re-upload is a new upload, not a move: it writes new
chunks and does not touch the originals. A group always names at least one
account. Removing the last member is refused; delete the group instead.

## Albums and folders

A Google album cannot span accounts. A folder therefore maps to one album per
owning account plus the local folder entry, and the existing
`albums[email][folder]` shape already models that. Group membership does not
change album assignment.

## Failure cases covered

- One member is paused during a listing: the result is partial, other members
  still list, and the paused member carries a retry window.
- Two accounts return the same media key: it merges once per chunk index.
- The owner is paused and its route is already known: download, trash, restore,
  and delete forever report `OWNER_PAUSED` and name that account, with no request
  to another member. A paused member in a full merged listing omits its files
  and reports a partial state instead.
- Every member is paused: the assignment leaves files unassigned.
- File sizes are very uneven: byte totals stay close without splitting a file.
- The owner was removed from the group: routing reports `OWNER_NOT_IN_GROUP`.
- Two accounts share one IP and one receives heavy traffic: the other stays
  clean. This is the independence test under an active throttle, which the
  research could not run.

## Implementation status

Shipped:

- the group schema and tolerant stored-data parsing;
- deterministic, size-weighted file assignment with per-member availability;
- a merged listing with per-account state, deduplication, and partial results;
- owner routing for downloads, trash, restore, and delete forever;
- group upload orchestration, with one concurrency pool and breaker per
  account, waiting files when every member is paused, and per-owner album
  mirroring;
- the `group` CLI commands and `--group` on file list, upload, download, and
  trash (the `delete` command), with an owner column and owner in JSON;
- group management in Settings: list, create, rename, delete, add and remove
  members, member status, and warnings for removals;
- empty states for no groups, a single-member group, and a fully paused group;
- an upload target selector beside the upload button, persisted with the other
  preferences and defaulting to the selected account;
- a merged group listing with owner labels, media-key deduplication, and a
  partial state that names paused members and their retry window;
- a merged Trash view with owner labels and owner routing for Restore and Delete
  forever;
- owner routing for downloads, trash, restore, and delete forever, with a paused
  owner reporting why the file is unavailable;
- pause state fed by the merged listing and by upload retry windows.

Not shipped:

- cross-account grouping by file id and chunk index;
- CLI commands to list trash, restore, or delete forever; the CLI can only move
  files to trash;
- album migration, rebalancing, or moving existing files.

Without a group, every path uses the selected account: no extra listing calls or
config reads.
