# Server-authoritative shares

Status: design and research. This document does not authorize an implementation. Sharing remains unavailable until the private Google Photos operations below are verified against current provider behavior.

## Decision

Issue #64 asks for durable, server-authoritative shares. The current integration has no share implementation. The historical fork has a browser-local share feature and a set of private Google Photos RPC calls, but its tests use fake fetchers and synthesized protobuf responses. No recorded provider response, live integration test, or current credential-backed run proves that Google still accepts those RPC ids, field numbers, states, or response shapes.

The missing piece is not only request shape. After an ambiguous create, the historical protocol has no proven discovery, list, or get operation for the remote album or envelope. A public URL probe can verify a known link, but it cannot discover an unknown one. Implementing create now would therefore add an unrecoverable orphan case in the exact lifecycle that #64 requires to be recoverable.

This branch stops at the design and research gate. It adds no share schema, route, provider call, browser state, or UI. Issue #64 remains open.

## Acceptance criteria

| Requirement                                                  | Design response                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Shares isolated by authenticated user and Google account     | Session user and account are the only ownership inputs. Composite database constraints and scoped queries enforce isolation.      |
| Active shares survive reload, restart, and another device    | Server row is written before remote mutation and stores every handle needed for revocation. Browser storage is not authoritative. |
| Create ambiguity is recoverable and does not lose revocation | Requires a discovery or reconciliation operation. None is proven. This is an implementation blocker.                              |
| Revocation state is durable and testable                     | `active` to `revoking` to `revoked`, with verification before success.                                                            |
| Capability gating prevents unusable links                    | Sharing stays off until live create, public activation, and revoke verification pass.                                             |
| No historical browser compatibility                          | `phodrive-shares`, recovery JSON, and old client records are rejected.                                                            |
| Protocol assumptions are re-verified                         | This document lists every assumption as unverified and defines the live verification plan.                                        |

## Current state

At integration `50667c40508ea4cd75bfa0ea4f7493024bab0f5e`:

- No share route is mounted in `server/src/app.ts`.
- No share table exists in `server/src/db/schema.ts`; migrations end at account groups.
- No share model, server service, browser store, or UI exists in the current integration.
- User identity comes from the Better Auth session through `requireUser`.
- A selected Google account is resolved from `x-phodrive-account-id` scoped to that session user. Unknown account ids fail closed.
- Groups are per-user sets of Google accounts used for browsing and uploads. They are not share audiences.
- The server already owns encrypted Google credentials. A share API must never accept or return them.
- Google requests use the per-account `ThrottleCoordinator` in `ServerContext`.

## Historical evidence

The historical fork is `f1206ffed73d259bbbc06c29f2618bc79f0defbf`. It is research evidence only.

| Item                                                                                 | Classification                      | Use                                                                 |
| ------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------- |
| Browser `phodrive-shares` store, recovery JSON, email-keyed records                  | Historical baggage                  | Reject. It restores browser authority and has no migration value.   |
| Browser share dialogs and share list                                                 | Historical baggage                  | Reject unless a future product slice needs a new UI.                |
| Unauthenticated `/api/share` accepting email and token                               | Historical baggage                  | Reject. It conflicts with session auth and server-held credentials. |
| `shared.phodrive.dev` manifest links                                                 | Historical baggage for this feature | Do not make a separate viewer deployment a sharing prerequisite.    |
| Album create/remove and media-key batching                                           | Protocol hypothesis                 | Research input for live verification.                               |
| Envelope create/delete and link-state RPC                                            | Protocol hypothesis                 | Research input for live verification.                               |
| Public short-URL and canonical-album probing                                         | Still-valid observation method      | Can verify a known public link. It is not discovery.                |
| Lifecycle lesson: remote mutation and local persistence are separate failure domains | Still valid                         | Drives the pending-state design.                                    |

## Protocol hypothesis

Everything in this section is unverified. The only source is the historical fork. The names and numbers are recorded so a future live experiment can confirm or replace them.

| Operation              | Historical request                                                                                                                                                                           | Historical response evidence                                                                          | Status                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Create album           | `POST https://photosdata-pa.googleapis.com/6439526531001121323/8386163679468898444` with title, timestamp, media keys, device fields                                                         | Album key parsed at nested field `1.1`                                                                | Unverified                                     |
| Remove album           | `POST .../11165707358190966680` with album key at field 1                                                                                                                                    | Empty success body                                                                                    | Unverified                                     |
| Create envelope        | `POST .../11663664809460121647` with album target, title, permissions, client info, response masks                                                                                           | Envelope key at field 1; optional pending short URL at field 2                                        | Unverified                                     |
| Enable or disable link | `POST https://photosdata-pa.googleapis.com/$rpc/social.frontend.photos.sharingdata.v1.PhotosSharingDataService/PhotosUpdateLinkSharingState` with envelope key at `1.1` and state at field 2 | Short URL at nested `1.1`; auth key at field 2                                                        | Unverified                                     |
| Delete envelope        | `POST .../8089014401670041416` with envelope key at field 1                                                                                                                                  | Empty success body                                                                                    | Unverified                                     |
| Resolve public link    | `GET` short URL with manual redirects, then `GET` the canonical `photos.google.com/share/...` page                                                                                           | A 200 HTML page is treated as live; 401, 403, 404, 410, or a non-share redirect is treated as stopped | Partially observable, not tied to RPC identity |

Remote identifiers in the historical record:

- `albumKey` from album creation, required for album removal.
- `envelopeKey` from envelope creation, required for link disable and envelope deletion.
- `pendingShortUrl` from envelope creation, optional.
- `shortUrl` and `authKey` from link enablement. `authKey` had no consumer in the historical revoke path.
- `albumUrl`, the provider canonical URL resolved from the short URL.
- `shareUrl`, a locally generated Phodrive manifest URL. It is not a Google identifier and is not needed for revocation.

Historical behavior that remains an assumption:

- Create is not idempotent. Every call creates a new remote album and envelope. There is no client idempotency key in the protocol evidence.
- Revoke accepts 404 and 410 as already gone, but this retry tolerance is only tested with mocks.
- A lost album-create or envelope-create response leaves an unknown remote object. No discovery RPC is proven.
- A lost link-enable response may expose a pending short URL, but the auth key and any rotated URL are unknown.
- A lost revoke response may have applied fully, partially, or not at all. The stored handles are required to retry.
- Account capability may vary by provider state. No evidence covers that variation.

## Evidence matrix

| Claim                                                            | Historical source                                                                    | Test evidence                               | Current live evidence | Status                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------- | -------------------------------------- |
| RPC ids and endpoints still work                                 | `core/src/server/photos/albums.ts`, `core/src/server/share/requests.ts` at `f1206ff` | Fake fetcher only                           | None                  | Unverified                             |
| Protobuf field numbers and enum values are current               | Same files                                                                           | Encoder and parser agree with test fixtures | None                  | Unverified                             |
| Album creation returns the album key at `1.1`                    | `albums.ts`                                                                          | Synthetic response                          | None                  | Unverified                             |
| Envelope creation returns key and optional pending URL           | `share/requests.ts`                                                                  | Synthetic response                          | None                  | Unverified                             |
| Link state enable returns short URL and auth key                 | `share/link.ts`, `requests.ts`                                                       | Synthetic response                          | None                  | Unverified                             |
| Link state disable and envelope/album deletion are retry-safe    | `share/revoke.ts`                                                                    | Mocked 404/410                              | None                  | Unverified                             |
| An existing remote share can be discovered                       | No implementation                                                                    | None                                        | None                  | Not proven                             |
| Public redirect and status probes prove activation or revocation | `share/public.ts`                                                                    | Mocked responses                            | None                  | Unverified for current Google behavior |
| AAS token authentication still reaches these RPCs                | Historical server code                                                               | Mocked auth                                 | None                  | Unverified                             |

## Required semantics

If the protocol gate is passed:

- The server, not the browser, is authoritative for every share.
- A share belongs to one authenticated user and one Google account.
- A share represents one remote album, one envelope, and one public link. Multi-file selections use one album and one manifest, not one remote object per chunk.
- The owner account is the account that owns every selected file and chunk. A group is not an owner. Group files use the actual member account.
- A share row is inserted before the first remote mutation and stores each remote identifier as soon as it is known.
- No client response claims success until the active row and its public URL are durable.
- A public link is never created unless a revocation handle is already durable.

## State machine

Proposed states:

| State      | Meaning                                                                  | Allowed exits                                                                                                                           |
| ---------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `creating` | Row exists; remote creation may be in progress or outcome may be unknown | `active` after durable full record and live verification; `failed` only after confirmed cleanup and proof that no link was ever enabled |
| `active`   | Link is live and every revoke handle is stored                           | `revoking`                                                                                                                              |
| `revoking` | Revocation or cleanup was attempted; the link may still be public        | `revoked` only after remote removal and stopped verification; remains `revoking` otherwise                                              |
| `revoked`  | Revocation is verified; terminal                                         | None                                                                                                                                    |
| `failed`   | Creation ended without a public link and cleanup is confirmed; terminal  | None                                                                                                                                    |

There is no separate ambiguous state. An old `creating` row is unresolved, not safe to retry blindly. The same applies to an old `revoking` row. `failed` is forbidden if a link may have been enabled. `revoked` is forbidden while any public probe still reports a live link.

## Data model

Proposed before implementation, subject to the product decision on multi-file shares:

```text
google_share
  id                 text primary key
  user_id            text not null
  google_account_id  text not null
  request_key        text not null
  name               text not null
  status             text not null
  envelope_key       text
  album_key          text
  pending_short_url  text
  short_url          text
  album_url          text
  share_url          text
  created_at         timestamp not null
  updated_at         timestamp not null
```

Constraints and indexes:

- Unique `(user_id, id)`.
- Unique `(user_id, request_key)` so a retried create cannot start a second remote grant after a lost response.
- Foreign key `(user_id, google_account_id)` to `google_account(user_id, id)` with `ON DELETE RESTRICT`. Cascading the account would drop the only revocation handles for a live public album.
- Check `status` in the five states above.
- Index `(user_id, google_account_id)` for the share list. The primary key covers direct lookup. No other index is justified yet.

The row stores no email, token, media key, chunk hash, or provider error. Those are either derived from the account and file tables or not needed for revocation.

A second `google_share_file` table is needed only if the first release allows more than one file per share. It would store `(user_id, share_id, file_id)` with a composite foreign key and no chunk rows. Multi-file sharing is an open product decision, not a protocol requirement. Starting with one file per share avoids a speculative relation.

## API

Proposed only after the capability gate is passed:

- `POST /api/shares` with a client request key, one file identity, and a display name. The server resolves the account and verifies file and chunk ownership. A retry with the same request key returns the same row without repeating remote creation.
- `GET /api/shares` returns owner-visible summaries for the session user and selected account.
- `GET /api/shares/:id` returns a summary only to that user. Foreign or missing ids return 404.
- `POST /api/shares/:id/revoke` starts revocation and returns the durable state. Success is not reported until the row reaches `revoked`.

Responses contain share id, state, display name, file display metadata, and the public URL only when active. They never contain Google tokens, media keys, signed media URLs, raw RPC payloads, or another user's identifiers. The client cannot set the owner user or account.

## Failure and recovery

| Scenario                                                            | Durable result                                                   | Allowed response                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Pending row, remote create succeeds, final commit succeeds          | `active` with complete handles and live link                     | Success                                                                        |
| Pending row, remote create fails definitively                       | `failed` only after cleanup is confirmed and no link could exist | Failure                                                                        |
| Pending row, remote create succeeds, connection or response is lost | `creating`, possibly with a known album or envelope key          | Do not claim success or no-op. Requires discovery or manual recovery.          |
| Remote create succeeds, final row update fails                      | `creating` with known handles                                    | Retry the update, otherwise keep pending. Never report active.                 |
| Revoke succeeds remotely, local update fails                        | `revoking` with full handles                                     | Retry the update. Never report revoked.                                        |
| Revoke may have applied but response is lost                        | `revoking`                                                       | Retry disable, delete, and remove; verify probes.                              |
| Local commit succeeds, HTTP response is lost                        | Durable state already exists                                     | A retry with the same request key returns the same result without remote work. |
| Restart with `revoking`                                             | Full handles are present                                         | Resume revocation.                                                             |
| Restart with `creating`                                             | Only persisted handles are known                                 | Resume only known cleanup. Never create a second album or envelope.            |

The lost album or envelope response is the hard blocker. Without a proven discovery operation, the server cannot tell whether an unknown remote object exists, and cannot store a revocation handle. The only safe behavior is to keep sharing disabled until this is resolved.

## Isolation and security

- The session user is the only principal. The body cannot supply an owner user, owner email, token, or arbitrary account id.
- The selected account is resolved from the session and the account header, then checked against `google_account`.
- Share lookup, list, and revoke filter by `user_id`. Foreign share ids return 404.
- A share's account and file ownership are verified server-side against owner-scoped data. Client-supplied file hashes and media keys are not authorization.
- Group files use the owning member account id, not the group id, session default, or email.
- Share ids are not authorization tokens for content. Public URL access is controlled by the provider, and the local API never proxies content from a guessed share id.
- The remote identifiers are server-only. The browser receives only the public URL and summary state.

## Throttling

Create and revoke calls use the existing `ServerContext` throttle coordinator, keyed by the owning `account.id`. No share-specific coordinator, cooldown table, or request-local coordinator is allowed. Public URL probes are unauthenticated link checks, not account API calls, and must not consume another account's cooldown.

## Capability gate

Sharing is disabled by default until all of the following are proven:

1. A live authenticated create returns stable album and envelope identifiers.
2. Link enablement returns a short URL that resolves to a live canonical album page.
3. Link disable, envelope deletion, and album removal stop the public link, including their 404 and 410 behavior.
4. A lost create response can be discovered or reconciled, or the design can prove no public link was created.
5. A lost revoke response can be retried from durable handles and verified stopped.
6. Account capability variation is known, and unusable accounts are rejected before mutation.

Until then, no share route should be mounted and no public link should be issued.

## Live verification plan

Use a dedicated test account and one small, non-sensitive media item. Record sanitized request and response shapes, never tokens or account secrets.

1. Create an album with one media key. Confirm the album appears in the account and capture the returned identifier.
2. Create an envelope for the album. Capture the key and any pending short URL.
3. Enable link sharing. Capture the short URL, auth key, redirect chain, and canonical page status.
4. Disable the link, delete the envelope, and remove the album separately. Probe the short, canonical, and direct media URLs after each step.
5. Repeat create and revoke calls. Record whether create duplicates, whether revoke is idempotent, and which statuses mean already gone.
6. Drop the connection after each remote call and before reading the response. Check whether the account exposes a way to discover the created object.
7. Repeat with a multi-chunk file and confirm the album contains every chunk media item and the public page exposes all of them.
8. Exercise 429, 5xx, cancellation, and token expiry against the existing throttle and auth layers.
9. Test at least two accounts in different provider states.

The implementation gate is not passed if step 6 has no deterministic answer, or if revoke cannot prove the link stopped.

## Rejected historical baggage

- `phodrive-shares`, browser-local authoritative records, and email-keyed storage.
- Old recovery JSON and compatibility loaders.
- Browser-supplied Google credentials on share routes.
- Manifest `shareUrl` as a required product dependency.
- Stored `authKey` without a consumer.
- Old share UI and old localStorage tests.
- Automatic migration of historical browser share data.
- Any claim that mocked protobuf tests verify current Google behavior.

## Open product decisions

- Single-file shares only, or multi-file selections. The remote unit is one album and one link either way.
- Whether the public share URL is the provider canonical URL or a new Phodrive viewer. The old viewer deployment is not part of current integration.
- Whether expiration or link rotation is required. The historical record had no expiry.
- Whether a shared file that is trashed or permanently deleted should be revoked automatically. Automatic revocation is irreversible and needs an explicit product rule.

## Implementation gate

No implementation PR should start until the live verification plan is complete and the ambiguous-create gap has a deterministic recovery or an explicit product decision to prohibit that path. The next implementation, if approved, should start with the schema and capability gate, then the server lifecycle, then the minimal owner API. A UI is not required for the first server slice.
