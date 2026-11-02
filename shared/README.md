# Phodrive shared

A standalone Cloudflare Pages app for opening a Phodrive share. The browser rebuilds the original file from Google Photos chunks, checks the SHA-256 from the chunk headers, and saves the result. Two stateless Pages Functions proxy the public album listing and the public Google bytes.

The app has no R2, D1, or KV binding. It stores no files, keeps no database, and never uses an owner Google token. The viewer runs entirely from static assets.

## What it does

- Reads `#share=<base64url(JSON)>` from the URL fragment. The fragment is never sent to the server or written to an API request.
- `POST /api/album` reads the public Google Photos page, uses the current `snAcKc` RPC declared in `AF_dataServiceRequests`, falls back to `AF_initDataCallback`, and returns normalized items with `=d` original URLs.
- `POST /api/bytes` accepts an `lh3.googleusercontent.com` URL and an optional closed byte range. It streams the response with `application/octet-stream`, `Content-Disposition: attachment`, and `nosniff`.
- The viewer probes each item for `BMSPLIT`, groups chunks by `fileId`, checks contiguous indices, the last flag, zero padding, per-chunk Brotli, and the final SHA-256.
- Missing files, missing chunks, and a missing final marker produce `Share incomplete` and no file.

## Manifest v1

```json
{
    "v": 1,
    "album": "https://photos.google.com/share/<albumUid>?key=<key>",
    "files": [
        {
            "id": "<64 lowercase hex characters>",
            "chunks": 3,
            "name": "notes.txt"
        }
    ]
}
```

The manifest is base64url encoded and placed after `#share=`. The album URL must be the canonical share URL. Short `photos.app.goo.gl` links are rejected so the proxy does not follow redirects.

## Local development

Requirements: Bun and Node.js 24 or newer.

```sh
cd shared
bun install
bun run check
bun run test
bun run build
```

The UI alone runs with `bun run dev`. Vite does not serve Pages Functions, so `/api` requests fail in that mode. For the full stack, build first and run Wrangler against the output and `functions/` directory:

```sh
bun run build
bunx wrangler pages dev
```

`wrangler pages dev` reads `pages_build_output_dir = "dist"` from `wrangler.toml`.

## Tests

```sh
bun run test
```

The suite covers manifest encoding, the BMP split parser, compressed and uncompressed chunks, 1, 3, and 20 chunk reassembly, missing files and chunks, zero padding, SHA-256 failures, range proxying, the host allowlist, malformed album listings, and a local mock Google server.

A live check is optional and read-only. It needs a public album URL and does not create a share:

```sh
SHARED_LIVE_ALBUM='https://photos.google.com/share/...?key=...' bun run test:live
```

The live test lists the album and streams a 64 KiB range from the first original. It never prints the album URL or key.

## Deploy

Create a Pages project or let Wrangler create one:

```sh
cd shared
bun install
bun run build
bunx wrangler login
bunx wrangler pages deploy dist --project-name phodrive-shared --branch main
```

To serve `shared.phodrive.dev`, open the Pages project, choose Custom domains, add `shared.phodrive.dev`, and follow the DNS prompt. The `functions/api/album.ts` and `functions/api/bytes.ts` files map to `/api/album` and `/api/bytes`. `public/_routes.json` limits Functions to `/api/*`, so all viewer assets are served directly by Pages.

`public/_headers` sets `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, a restrictive CSP, and `frame-ancestors 'none'`. The CSP allows `wasm-unsafe-eval` for the Brotli decoder. The decoder WASM is served from the same origin with a pinned SHA-384 integrity check, and `tests/brotli-integrity.test.ts` fails if the hash and the file disagree.

## Free tier limits

These are the Cloudflare Pages and Workers Free limits as of 2026-11-02. Check the official pages before relying on them.

| Limit              | Free plan                                      |
| ------------------ | ---------------------------------------------- |
| Static requests    | Unlimited                                      |
| Static bandwidth   | No Pages egress charge                         |
| Functions requests | 100,000 per day, shared with Workers Free      |
| Functions CPU      | 10 ms per request                              |
| Pages builds       | 500 per month, 1 concurrent, 20 minute timeout |
| Files per site     | 20,000                                         |
| Maximum asset      | 25 MiB                                         |
| Pages projects     | 100                                            |

The proxy uses little CPU because it only copies streams, so the 10 ms CPU limit is not tied to file size. Wall time is bounded by the client connection and the upstream stream.

## Abuse and cost controls

- The byte proxy allows only `https://lh3.googleusercontent.com/` and a narrow path shape. It does not follow redirects and rejects cross-host redirects.
- Only closed single ranges are accepted, with an 8 MiB span cap. A full chunk request has no range and is capped at 200 MB by `Content-Length`.
- Four byte streams and two album listings may run at once per isolate. These are best-effort in-memory caps, not a durable per-IP quota.
- The proxy accepts capability URLs only in POST bodies, does not log them, and does not cache responses.
- The viewer uses `showSaveFilePicker` when available and streams chunks to disk. The Blob fallback is limited to 512 MB. A failed hash check aborts the staged write before the file is offered.
- There is no durable rate limiter because the free plan has no KV or D1 binding in this app. Add a Cloudflare rate limiting rule on `/api/*` if the public deployment sees abuse.

## Limits and known gaps

- Google Photos share pages and the `snAcKc` RPC are internal interfaces. The proxy fails closed if the RPC IDs, field positions, or item shapes change.
- Pagination above 20 items has not been verified. The listing must report a count that matches the item array, and the viewer must see every manifest file and chunk, or it reports `Share incomplete`.
- Anonymous Google downloads may be rate-limited. The proxy returns a clear upstream error and does not retry with a token.
- The file hash catches corruption. It does not authenticate a malicious album owner.
- Revocation stops new downloads. Bytes already saved cannot be recalled.

## Licenses

The app depends on `hash-wasm` (MIT), `brotli-dec-wasm` (MIT OR Apache-2.0), `zod` (MIT), and `results-ts` (MIT). Their package licenses apply.
