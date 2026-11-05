# Server-authoritative shares

Status: APK-backed design and research. This document does not authorize an implementation. It replaces the earlier assumption that Google exposes no way to enumerate existing shares.

## Decision

Google Photos 7.98 contains account-scoped sharing enumeration and read operations. The sharing management screen is backed by a local database populated by `PhotosSyncSharedCollections`. The sync response can carry the provider collection identity and the full collection record, including a current short URL and auth key.

A lost client response is therefore not proof that the provider share is unknowable. The server can reconcile provider state from Google instead of treating every ambiguous response as a permanent local recovery record.

The private RPC contract is not live-verified. The evidence below comes from the shipped APK, not from a captured Google response. The protocol gate looks passable, but live verification is still required before implementation.

## APK provenance

| Field        | Value                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| File         | `com.google.android.apps.photos_7.98.0.1007591100-52591217_minAPI24(arm64-v8a)(nodpi)_apkmirror.com.apk` |
| Package      | `com.google.android.apps.photos`                                                                         |
| Version name | `7.98.0.1007591100`                                                                                      |
| Version code | `52591217`                                                                                               |
| SHA-256      | `1357526E4EBB2516F556B2BE9ACF516EBEC80BC1665BA49515C5664A1564C903`                                       |
| ABI          | `arm64-v8a`                                                                                              |
| Min SDK      | 24                                                                                                       |
| Target SDK   | 37                                                                                                       |

The APK is not committed. Analysis used JADX 1.5.6 and the Android build-tools manifest dump. No credentials, cookies, tokens, account identifiers, or private media identifiers are recorded here.

## Current integration

At integration `50667c40508ea4cd75bfa0ea4f7493024bab0f5e`:

- No share route, schema, model, service, browser store, or share UI exists.
- User identity comes from the Better Auth session through `requireUser`.
- The selected Google account comes from `x-phodrive-account-id`, scoped to that user. Unknown ids fail closed.
- Groups are per-user sets of Google accounts for browsing and uploads. They are not share audiences.
- The server holds encrypted Google credentials and never returns them.
- Google requests use the existing per-account `ThrottleCoordinator` in `ServerContext`.

## APK evidence

Confidence values:

```text
verified from APK       class, method, field, or call chain is present in the shipped APK
strongly inferred       the call chain supports the conclusion but no live response was observed
historical only         evidence exists only in the old better-phodrive implementation
unknown                 not established
```

### Enumeration and read operations

The current sharing service is `social.frontend.photos.data.v1.PhotosFeService` on host `photosdata-pa.googleapis.com`.

| Operation                      | Evidence                                                                                                                                                                                   | Confidence                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `PhotosSyncSharedCollections`  | `cpxx` registers the method at line 282; `cpxs` binds the name at line 446; `bmhg` builds the request and consumes the response                                                            | verified from APK                           |
| `PhotosReadSharedCollections`  | `cpxx` registers the method at line 277; `cpxr` binds the name at line 536                                                                                                                 | verified from APK                           |
| `PhotosCreateEnvelope`         | `cpxx` registers the method at line 301; `cpxt` binds the name at line 469; `afza` builds the request                                                                                      | verified from APK                           |
| `PhotosDeleteEnvelope`         | `cpxx` registers the method at line 307; `cpxt` binds the name at line 505; `oni` builds the request                                                                                       | verified from APK                           |
| `PhotosCreateAlbum`            | `cpxx` registers the method at line 298; `cpxs` binds the name at line 554                                                                                                                 | method present, no current call chain found |
| `PhotosUpdateLinkSharingState` | service `social.frontend.photos.sharingdata.v1.PhotosSharingDataService`; `cqst` returns the explicit `/$rpc/.../PhotosUpdateLinkSharingState` path at line 291; `agpj` builds the request | verified from APK                           |

`PhotosSyncSharedCollections` and `PhotosReadSharedCollections` are current operations. The historical better-phodrive implementation did not implement either, which is why its missing-enumeration conclusion was a limitation of that implementation, not of Google.

### How sharing management gets its data

The current app does not query Google each time the sharing management screen opens. It synchronizes shared collections into a local SQLite database and renders from that database.

Call chain for the shared-links screen:

```text
ManageSharingActivity
  -> bhgv (Manage sharing menu)
  -> ManageSharedLinksActivity
  -> ManageSharedLinksFragment
  -> bjkn / bdpa
  -> local envelopes table
```

`ManageSharedLinksFragment` builds its list adapter from `envelopes` rows. The database view `envelope_covers` includes `envelopes.media_key`, `short_url`, `auth_key`, `title`, owner, viewer, item counts, and link capabilities. The screen does not call a list RPC directly.

The synchronization path:

```text
bivc (SyncSharedCollections)
  -> SyncSharedCollectionsTask
  -> bmhg (SyncSharedCollectionsOp)
  -> PhotosSyncSharedCollections
  -> cpwf response
  -> apgs applies each cpwe item to envelopes and collections
```

`bivc.c()` starts `SyncSharedCollectionsTask` with `apgw.VIEW_SHARED_COLLECTIONS_LIST`. `bhkf` handles the result and retries while the response says `continue_sync`.

### Sync request

The request message is `cpwb`, built by `bmhg.b()`.

| Field | Evidence                                        | Meaning                      | Confidence                                            |
| ----- | ----------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| 1     | repeated `cpwa` built from local `bmhd` entries | Local collection sync states | verified from APK; exact empty-state behavior unknown |
| 2     | `cmkb` from `alzn`                              | Metadata sync state          | strongly inferred                                     |
| 3     | `clvw` from `alzn`                              | Metadata sync state          | strongly inferred                                     |
| 4     | `clyj` from `alzn`                              | Metadata sync state          | strongly inferred                                     |
| 5     | `clvm` from `alzn`                              | Metadata sync state          | strongly inferred                                     |
| 6     | `clxu` from `alzn`                              | Metadata sync state          | strongly inferred                                     |
| 7     | `cmho` from `alzn`                              | Metadata sync state          | strongly inferred                                     |
| 8     | `cmew` from `alzn`                              | Metadata sync state          | strongly inferred                                     |
| 9     | integer list                                    | Feature flags                | strongly inferred                                     |
| 10    | `cnbj` from `alzn`                              | Optional metadata sync state | strongly inferred                                     |

`bmhf` limits a batch to ten local collection entries. `ReadEnvelopeTask` uses the same synchronization operation with one collection state (`aggm`, `bmhf`, `bmhd`) to refresh a specific envelope. `PhotosReadSharedCollections` is available for a direct read by known collection identities, but the traced app paths use the sync operation.

### Sync response

The response is `cpwf`, a repeated list of `cpwe`.

| Field                | Evidence                                              | Meaning                                   | Confidence                                                   |
| -------------------- | ----------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `cpwe.d`             | string                                                | Resume token                              | verified from APK                                            |
| `cpwe.e`             | `cmia` message; `cmia.c` used as remote collection id | Stable collection media key               | verified from APK                                            |
| `cpwe.f`             | `clxa` full collection                                | Full collection record                    | verified from APK                                            |
| `cpwe.g`             | repeated message                                      | Shared media or members                   | verified from APK; exact role follows `apgs`                 |
| `cpwe.h`             | repeated message                                      | Collection members                        | strongly inferred                                            |
| `cpwe.i`             | repeated message                                      | Comments or media metadata                | strongly inferred                                            |
| `cpwe.j`             | repeated message                                      | Hearts or reactions                       | strongly inferred                                            |
| `cpwe.k` to `cpwe.n` | repeated messages                                     | Other collection relations                | verified from APK; exact roles not needed for share identity |
| `cpwe.o`             | string                                                | Next sync token                           | verified from APK                                            |
| `cpwe.p`             | `cpwd` enum                                           | Syncability: unknown, syncable, too large | verified from APK                                            |
| `cpwe.q`             | `cpwe` deletion enum                                  | Deletion or reset state                   | verified from APK                                            |
| `cpwe.r`             | `cpwc` flags                                          | Reset actions                             | verified from APK                                            |

The full collection record `clxa` contains the collection metadata at `clxa.e` (`clwm`). The app writes that metadata into the local `envelopes` table in `acdv.n`:

| Local column               | Source                                 | Evidence                                                        |
| -------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `envelopes.media_key`      | `clxa` collection media key (`cmia.c`) | `apgs.h` uses `ajzs.a(cmiaVar.c)`; `bhsf` keeps the full record |
| `envelopes.title`          | `clwm.d`                               | `acdv.n` line 174                                               |
| `envelopes.auth_key`       | `clwm.l`                               | `acdv.n` line 124                                               |
| `envelopes.short_url`      | `clwm.n` (`clwo.c`)                    | `acdv.n` lines 406-427                                          |
| `envelopes.owner_actor_id` | `clwm.c`                               | `acdv.n` line 114                                               |
| `envelopes.can_link_share` | `clwm.p` capability data               | `acdv.n` line 252                                               |
| `envelopes.protobuf`       | full `clxa` record                     | `acdv.n` line 445                                               |

The response can therefore contain a current short URL and auth key for a known collection. The local database is a cache of provider state, not the source of truth.

### Create, link, and delete

`PhotosCreateEnvelope` uses request `cpmo` built by `afza.b()`. The request contains collection details, media items, title, and client information. The response `cpmp` carries two string identifiers and an optional full `clxa` collection (`afza.f`). The app persists the resulting collection through `GetOrCreateEnvelopeTask` and the local envelope store.

`PhotosCreateEnvelope` does not expose the album publicly by itself. Link sharing is a separate `PhotosUpdateLinkSharingState` call.

`agpj` builds the current link-state request `cqto`:

| Field    | Meaning                           | Evidence                                                      |
| -------- | --------------------------------- | ------------------------------------------------------------- |
| `cqto.c` | `cmia` collection media key       | `agpj.b()` sets `cmia.c` from the local remote collection key |
| `cqto.d` | link state: 1 disabled, 2 enabled | `agpj.b()` maps the boolean to `(true ? 3 : 2) - 1`           |

The response `cqtp` contains:

| Field    | Meaning                                 | Evidence                    |
| -------- | --------------------------------------- | --------------------------- |
| `cqtp.b` | `clwo` short URL                        | `agpj.f()` reads `clwo.c`   |
| `cqtp.c` | auth key                                | `agpj.f()` reads the string |
| `cqtp.d` | repeated `cmht` capabilities/recipients | `agpj.f()` stores the list  |

Public exposure begins when `PhotosUpdateLinkSharingState` enables the link, not when the collection or envelope is created. This is a strong inference from the separate create and link-state call paths. Live verification must confirm that a created but link-disabled collection is not publicly reachable.

`PhotosDeleteEnvelope` uses request `cpnt` built by `oni`. It carries the collection media key and two flags. `DeleteSharedCollectionTask` uses it to remove a shared collection. Whether this removes the underlying Google album, or only the sharing envelope, is not proven. The app presents it as deleting the shared link/collection, but live verification is required.

`PhotosCreateAlbum` is present in the service descriptor but no current call chain was found. The historical separate album-create endpoint is not present in the current APK. The current shared-album path creates a collection through `PhotosCreateEnvelope` and manages the link separately.

### Stable provider identity

The stable provider identity is the collection media key (`cmia.c`, stored locally as `envelopes.media_key`). The app uses it for:

- link enable and disable (`agpj` request `cqto.c`);
- shared collection deletion (`oni` request `cpnt.c`);
- reading a specific envelope through the sync operation (`aggm`/`bmhd`).

The short URL is not stable identity. It is a field in the full collection record (`clwm.n`, `clwo.c`) and is returned again by link-state changes. The auth key is also a field (`clwm.l`), not a revoke handle.

The historical split between `albumKey`, `envelopeKey`, `pendingShortUrl`, and `authKey` is not reflected in the current link-state request. The current APK uses one collection media key for link and delete operations. The old split must not be made mandatory without live evidence.

## Reconciliation model

### Lost create response

If `PhotosCreateEnvelope` succeeds and the response is lost, the collection is expected to appear in a later `PhotosSyncSharedCollections` result for the same account. That expectation still needs live verification: the APK proves the sync operation and the top-level collection fields, but it does not prove that a fresh empty-state sync returns every collection or that the response exposes the complete media-key set.

Do not automatically adopt a candidate by title or media-key set. Identical files and duplicate titles can produce an existing collection that looks like the lost create. If exactly one candidate appears, it is still only a candidate. Keep the local row unresolved and require explicit confirmation, or use a provider-visible correlation marker that live verification proves unique. If several candidates appear, fail closed and require an explicit choice. Do not create another collection and do not revoke a candidate merely because it is the only visible match.

`PhotosReadSharedCollections` can read known collection identities. It does not solve the first match, but it removes the need to persist every provider handle after identity is known.

### Lost revoke response

If `PhotosDeleteEnvelope` or link disable succeeds and the response is lost, a later sync may show whether the collection still exists and what link fields it carries. Absence from one incremental or incomplete sync does not prove deletion. Disabling the link does not prove that `PhotosDeleteEnvelope` succeeded.

The revoke is complete only when both conditions hold:

- a full or otherwise authoritative sync shows the collection removed, or shows the provider's verified deletion state;
- public URL checks confirm that no previously issued link still serves the content.

Until both hold, keep the local row and retry or verify from the stable collection media key. Do not remove the local association merely because one sync page omitted the collection.

### Lost link response

If `PhotosUpdateLinkSharingState` succeeds and the response is lost, a later sync may return the current short URL and auth key in the full collection record. The APK does not prove how a disabled link is represented. A disabled record may retain a previous short URL or omit it. Do not infer link state from URL absence, and do not retry enablement until the live plan establishes the disabled-link representation and the field that reports link state.

## What local PostgreSQL must store

Google is authoritative for provider existence, link state, the current short URL, the auth key, and the collection media key. Local storage is authoritative only for the Phodrive association and idempotency.

Proposed `google_share` row:

```text
google_share
  id                       text primary key
  user_id                  text not null
  google_account_id        text not null
  request_key              text not null
  file_id                  text not null
  file_hash                text not null
  name                     text not null
  provider_collection_key  text
  created_at               timestamp not null
  updated_at               timestamp not null
```

Constraints:

- Unique `(user_id, id)`.
- Unique `(user_id, request_key)` so a lost create response cannot start a second remote collection.
- Foreign key `(user_id, google_account_id)` to `google_account(user_id, id)` with `ON DELETE RESTRICT`. Cascading the account would drop the local association while a public link may still exist.
- Index `(user_id, google_account_id)` for listing. The primary key covers direct lookup.

`provider_collection_key` is nullable while a create is in flight or before reconciliation. It is the only provider handle that merits local persistence because it is the stable match for revoke and read. `short_url`, `auth_key`, `album_url`, and a Phodrive manifest `share_url` are not required columns. They are provider state that can be read from the sync record. If a cached short URL is later needed for display latency, it must be treated as a cache with reconciliation, not as authority.

No `envelope_key`, `album_key`, `pending_short_url`, or `share_url` columns are proposed. No `auth_key` column is proposed; it is not needed for revoke and is not a stable identity.

The initial #64 slice should support one Phodrive file per share. A `google_share_file` relation is not required until multi-file sharing is a product decision. If multi-file is approved, add one relation row per file instead of duplicating file identity on the share.

## Local state model

Do not mirror Google's `active`, `revoked`, or link states in PostgreSQL. They can change outside Phodrive and are returned by sync. A local row represents a Phodrive-created or adopted share, not a copy of provider state.

The row has:

- an identity and request key;
- an owning user and Google account;
- a Phodrive file association;
- a nullable provider collection key;
- timestamps for cleanup and diagnostics.

Once the live plan verifies how the sync record represents link state, provider state can be computed at read time by reconciling the account's sync records with local rows. A local row whose provider collection no longer exists is stale. It can be hidden from active lists and removed after reconciliation. It is not a public grant.

This reduces the local state machine to idempotent create and revoke operations plus reconciliation. A local persistence failure after a remote create does not lose the provider share, because the collection remains enumerable. It can still require explicit confirmation before the server attributes that collection to the lost local create.

## API

Proposed, not implemented:

- `POST /api/shares` with a client request key, one file identity, and a display name. The server resolves the session user, selected Google account, and file ownership. It returns the local share id and the reconciled provider state.
- `GET /api/shares` reconciles the account's existing shared collections with local rows and returns owner-visible summaries.
- `GET /api/shares/:id` returns one local share summary only to its owner.
- `POST /api/shares/:id/revoke` disables the link and deletes the shared collection, then reconciles and removes the local association only after the provider no longer exposes it.

Responses contain share id, local file display metadata, display name, provider state, and the current public URL when a link is active. They never contain tokens, raw RPC payloads, media keys, or signed media URLs. The client cannot set the user, account, or provider key.

The browser operates in Phodrive terms. It does not send provider identifiers except the local share id.

## Isolation and security

- The session user is the only principal.
- The Google account is resolved from the session and the account header, never from the request body.
- Share queries filter by user. Foreign or missing ids return 404.
- File ownership is verified against server-owned metadata for the selected account. Client media keys are not authorization.
- Group files use the actual owning member account id.
- Provider collection keys are server-only.
- A public link is never reported as active until the provider sync record confirms it.
- Account deletion is `RESTRICT` while local share rows exist. The account must be reconciled or its shares revoked first.

Cross-user and cross-account isolation require database and route tests, not only unit tests.

## Throttling

Create, link, delete, and read operations use the existing `ServerContext` coordinator keyed by the owning `account.id`. No share-specific coordinator, request-local coordinator, or persistent cooldown table is allowed. Public URL checks are unauthenticated link checks, not account API calls.

## Historical comparison

| Historical behavior                         | Current APK                                                                                                                          | Consequence                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Numeric create-album endpoint               | `PhotosCreateAlbum` method present; current shared-album path uses `PhotosCreateEnvelope`; no source call found for the album method | Historical endpoint is not evidence of the current path                 |
| Numeric remove-album endpoint               | `PhotosDeleteEnvelope` method; `DeleteSharedCollectionTask` uses it                                                                  | Current removal unit may be the shared collection, not a separate album |
| Numeric create-envelope endpoint            | `PhotosCreateEnvelope` named method                                                                                                  | Historical RPC id is obsolete evidence                                  |
| Link state request with envelope key        | `PhotosUpdateLinkSharingState` with collection media key and state 1/2                                                               | One stable collection key replaces the old split                        |
| No enumeration in historical implementation | `PhotosSyncSharedCollections` and `PhotosReadSharedCollections`                                                                      | Enumeration is possible; the old limitation was local                   |
| Short URL stored from link response         | Short URL is part of the full collection sync record                                                                                 | Reconciliation can recover it                                           |
| Browser-local records                       | No current Phodrive share implementation                                                                                             | Do not migrate `phodrive-shares` or old recovery JSON                   |

## Verification plan

Static APK evidence is not a live provider verification. Before implementation:

1. Use a dedicated test account and non-sensitive test media.
2. Create one shared collection, disable the link, and confirm it is not publicly reachable.
3. Enable the link and confirm the short URL resolves to the canonical album page.
4. Clear all local Phodrive state, run `PhotosSyncSharedCollections` with a fresh account state, and confirm the collection is listed with its collection media key, short URL, auth key, title, owner, and media items.
5. Disable the link and record whether the sync record retains, loses, or changes the short URL and which field reports the disabled state.
6. Re-enable the link and record whether the short URL changes, whether the old URL stops working, and whether the collection media key remains stable.
7. Delete the shared collection and confirm the full sync no longer lists it and the public URL stops serving.
8. Drop the connection after create, after link enable, and after delete, then reconcile from sync. Confirm the collection is discoverable and can be explicitly associated without creating a duplicate or revoking an existing collection.
9. Confirm the empty-state initial sync returns all collections, not only recent activity.
10. Repeat with a multi-chunk file and confirm the album contains every chunk and the public page exposes all of them.

Do not implement until steps 4, 6, 7, and 8 are answered with current provider evidence.

## Effect on issue #64

The provider enumeration changes the implementation shape. The old issue language implies a durable mirror of provider lifecycle state. That is no longer necessary if current Google enumeration works as the APK indicates.

Recommended acceptance language:

- The server is authoritative for the Phodrive user, account, file association, and idempotency key.
- Google is authoritative for provider collection identity, link state, and current public URL.
- Lost create and revoke responses are reconciled from provider enumeration before any retry.
- Local rows are never treated as proof that a public link exists.
- Revocation must be verified against provider state before the local row is removed.
- Rotation support is not implied by reconciliation. Link replacement must be tested separately.

Issue #64 remains open until the live verification plan passes and an implementation PR lands.

## Rejected historical baggage

- `phodrive-shares` and browser-local authoritative records.
- Old recovery JSON, compatibility loaders, and migration code.
- Browser-supplied email and token on share routes.
- Manifest `shareUrl` as a required product dependency.
- Stored `authKey` without a current consumer.
- `albumKey`, `envelopeKey`, and `pendingShortUrl` as mandatory local fields without current evidence.
- Old share UI and localStorage tests.
- Treating historical mock protobuf tests as provider verification.

## Open questions

- Does a fresh sync with empty local state return every shared collection, including inactive links?
- Does `PhotosDeleteEnvelope` remove the underlying album or only the sharing record?
- Does link re-enable change the short URL, and does the old URL stop serving?
- Does the sync response expose every collection that can still be revoked?
- Are account capabilities or collection size limits exposed before create?

These are live verification questions, not reasons to mirror provider state locally.

## Implementation gate

The protocol gate appears passable because enumeration and stable collection identity exist in the current APK. Implementation can proceed only after the live verification plan answers the open questions. The first implementation should be the schema and reconciliation service, then the owner API, then the minimal UI.

No implementation is included in this PR.
