# Public shares

A Phodrive share is a fixed snapshot in PostgreSQL. Its status controls public access. Creating or
revoking a share does not change Google Photos or create a Google album or share link.

The earlier research branch covers Google Photos album RPCs. This implementation does not call them.

Folder snapshots include active files in the selected folder and its descendants. A fully trashed
file is not part of the snapshot, and a folder with no active files cannot be shared. A partly
trashed, incomplete, or inconsistent child fails the whole share. A direct share of a trashed file fails. An unparseable provider entry also
fails the whole share because it may belong to the selected folder. A group share includes the
folder across its member accounts, and each file records its source Google email.

## Delivery path

```text
public viewer (browser)
    GET /api/public/shares/:token
        -> Phodrive server returns the stored manifest; no Google request
    POST /api/public/shares/:token/files/:fileId/chunks/:index
        -> server checks the active share, reads the source account by email
        -> one PhotosPrepareDownload RPC resolves the signed Google media URL
        -> server rechecks the share is active and returns an opaque capability
    GET /api/bytes  (Authorization: Bearer <capability>, Range: payload-relative)
        -> Cloudflare Pages Function decrypts and validates the capability
        -> streams only the payload bytes from Google
    browser verifies the final file SHA-256
```

Public bytes never pass through the Phodrive VPS. The VPS only issues metadata and capabilities. The
viewer never receives the Google media URL, the source file id, the source account or the original
parent folder. The manifest lists each file's path relative to the shared folder only.

## State

| Share status          | Trigger |
| --------------------- | ------- |
| (none) -> `active`    | create  |
| `active` -> `revoked` | revoke  |

Creation resolves the snapshot, then inserts the share, sources, files and chunks in one transaction.
The same request key and fingerprint return the existing share. The same key with different input
fails. There are no other states and no background work.

## Capability

`SHARE_CAPABILITY_KEY` is a 32-byte AES-256 key shared by the server and the Pages Function. Its only
accepted form is padded standard base64, the 44 characters `openssl rand -base64 32` prints. Both
sides apply the same check; the server refuses to start and the Function refuses every capability
if it does not match. A capability is `base64url(version || iv || ciphertext || tag)` produced with AES-256-GCM
and the AAD `phodrive-share-capability-v1`. Its payload names:

- share row id;
- opaque public file id;
- chunk index;
- signed Google media URL;
- split-prefix offset, the byte where the payload starts in the stored BMP;
- payload size;
- total BMP size;
- expiry as Unix seconds.

The viewer requests one capability per chunk immediately before downloading that chunk. A capability
is valid for **5 minutes** and can be reused during that time. It can only address its chunk's
payload. The edge proxy does not query PostgreSQL.

## Range mapping

The BMP's split prefix holds the original file name and parent folder, and padding follows the
payload. The edge removes both. The viewer sends a closed range relative to the payload:

```text
Range: bytes=start-end                          0 <= start <= end < payloadSize
upstream Range: bytes=(offset+start)-(offset+end)
Content-Range: bytes start-end/payloadSize
```

The proxy requires `206` and the exact mapped upstream `Content-Range`, sets an exact
`Content-Length`, streams the body without buffering it, aborts upstream on viewer cancellation or
after 30 idle seconds, rejects redirects, and accepts only the exact hosts
`lh1.googleusercontent.com` through `lh5.googleusercontent.com`. Live range tests observed Google
issuing only `lh3`; the other four are accepted CDN hosts that those tests did not exercise. It sends `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'` and `Referrer-Policy: no-referrer`.
The edge sends only `Range` and `Accept-Encoding` upstream. It receives no owner Google credentials.

An empty payload has no valid range, so the viewer skips its request.

## Revocation

Revoking sets the share to `revoked` in one local update. It makes no Google call, so it succeeds
even when every source account is disconnected, and reconnecting cannot revive the share.
Owner lists return only active shares. Revoked rows remain stored to enforce that decision.

The manifest and the chunk session stop serving as soon as the update commits. After the Google call,
issuance takes a shared lock on the share row, checks the status and creates the capability inside
one short transaction. Revoke's update waits for that lock, so every capability is ordered either
before or after the revoke, and none is created after it commits. A capability issued before the revoke stays valid until its own five-minute expiry.
Phodrive cannot invalidate signed Google media URLs that were already issued.

Owners can list and revoke shares while public sharing is disabled. Enabling it later does not
change a revoked share's status.

## Integrity

The immutable snapshot binds each file's SHA-256, source account, media key and expected chunk
metadata. PhotosPrepareDownload checks the media key and Google-side fingerprint as supported by
the existing download parser. The server derives the payload offset from the stored first-chunk
name, folder and split-header metadata. The authenticated capability binds that offset, payload
length and complete BMP extent. A viewer cannot supply another offset or request bytes outside it.

The browser receives payload bytes only. It checks chunk index, ordering, last-chunk marker and
exact payload size, incrementally hashes the reconstructed original, and requires its final SHA-256
to match the snapshot's `fileHash`. It does not verify the complete BMP SHA-1 per chunk because the
BMP wrapper is not transmitted. A new payload hash format would require changing uploads and stored
metadata; the existing immutable whole-file SHA-256 provides the final integrity check without it.

## Browser output

The main thread fetches one payload stream at a time and sends one block at a time to a Dedicated
Worker. The worker owns the incremental WASM SHA-256 hasher and the output sink. Tokens, capabilities
and Google media URLs are never sent to the worker.

Where a save picker is supported, the worker writes to its file handle and closes the writable only
after verifying the final hash. A failed hash aborts the pending write, preserving the existing file.
Otherwise it writes to an OPFS temporary through a synchronous access handle, then offers the
disk-backed File for download. It never constructs `Blob(parts)`. The browser reads that File from
OPFS for an unknown time after the click, so no timer removes the temporary. Cancellation and failed
writes remove it at once. A successful temporary stays until a later download starts and finds it
untouched for 24 hours, so OPFS can hold finished downloads for up to a day. Only `phodrive-share-`
entries are removed, and a cleanup failure never stops the new download. Progress counts completed chunks.

Application buffers hold the stream block in flight. Live tests must still verify 5 GB downloads,
memory use under load, native picker permissions and large OPFS exports in each supported browser.

## Product and issuance limits

Each share contains at most 500 files and 2,048 chunks. Its serialized public manifest is at most
256 KiB in UTF-8, including escaped strings and envelope fields. The server checks all three before
inserting any snapshot rows. The file limit keeps folder listings manageable; the chunk limit allows
large files, including the 26-chunk 5 GB example, while bounding database and capability work.

Public PrepareDownload work is limited to two concurrent requests and 60 starts per minute per
connected source account, across all its shares. Excess requests receive 429 without a wait queue.
The response includes `Retry-After`: one second for concurrent admission, or the remaining window
for the minute limit. Google throttling also returns 429 with its retry delay.
Calls still use the same per-account Google throttle coordinator as normal library operations.
Admission state expires after one minute. These limits are local to each process; multiple server processes multiply the allowance.

## Account identity

Share rows identify a source account by `google_account_email`, the owner's lowercase Google email,
not by the `google_account` row id. There is no foreign key to `google_account`: that row and its
token are disposable, while a share belongs to the Phodrive user. Every lookup is scoped to the
share's `user_id`, so another user connecting the same email gains nothing.

Disconnecting a Google account or signing out of Phodrive leaves every share row untouched. While the
account is disconnected:

- the manifest still resolves from PostgreSQL;
- chunk requests fail with `SHARE_ACCOUNT_DISCONNECTED`, because resolving a media URL needs a token;
- revoking still works.

Reconnecting the same email restores chunk requests for active shares.

## Request budget

One edge request and one PhotosPrepareDownload RPC per chunk, at the 195,000,000-byte payload ceiling:

| File size (decimal) | Chunks | Worker requests | PrepareDownload RPCs |
| ------------------- | -----: | --------------: | -------------------: |
| 100 MB              |      1 |               1 |                    1 |
| 1 GB                |      6 |               6 |                    6 |
| 5 GB                |     26 |              26 |                   26 |

A 5 GiB file needs 28 of each. Manifest and capability requests go to the Phodrive server, not the
Pages Function.

Each capability also requires one Google Android authentication request. The table counts edge
requests and PrepareDownload RPCs only.

These are network request-count estimates. They do not prove multi-GB browser support.

## Configuration

Sharing is optional. If either `SHARE_CAPABILITY_KEY` or `PUBLIC_EDGE_URL` is missing, the server
starts normally and `/api/session` reports `sharingEnabled: false`. Signed-in owners can list and
revoke existing shares. Creating shares, public manifests and chunk issuance return
`SHARE_DISABLED`. The Shares panel remains available and hides Copy link while sharing is off.
Configuring only one variable emits one startup warning naming both missing requirements, without
printing either value.

Set the same `SHARE_CAPABILITY_KEY` on the Phodrive server and the Cloudflare Pages project. Generate
one with `openssl rand -base64 32`. The key must not be committed.

Set `PUBLIC_EDGE_URL` on the Phodrive server to the origin of the Pages project that serves
`web/functions/api/bytes`. It must use https, or http on `localhost`, `127.0.0.1` or `[::1]`, and has
no credentials, path, query or fragment. The server refuses to start otherwise. The Function answers CORS preflight for the
`authorization` and `range` headers.

For local development, build the web app, then run `npx wrangler pages dev build --binding
SHARE_CAPABILITY_KEY=<key>` from `web`, where Wrangler finds `functions`. Point `PUBLIC_EDGE_URL` at
that local origin. The Vite proxy does not need an `/api/bytes` route.

Cloudflare Pages must build with `web` as the project root so it picks up `web/functions`; the static
site is still the SvelteKit `build` output.

## Draft database recovery

Anyone who ran the unmerged PR #90 draft schema locally must recreate that development database.
The rewritten `0002_public_shares.sql` is the only sharing migration; there is no migration or
production compatibility path from the abandoned draft schema.
