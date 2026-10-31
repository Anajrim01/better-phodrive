# Chunk compression measurements

The server compresses a chunk before BMP encoding only when the upload asks
for it, and stores it only when the result saves at least 5% of the original
bytes. Brotli quality 1 is the codec. The setting is off by default.
Measured with Node v24.11.1 on a 16-core Intel Core Ultra 7 255H running
Windows 11, using Node's built-in `zlib`. Each sample was compressed three times
after a warm-up; the table reports the median.

The samples are generated or taken from local files: 4 MiB of random English
words (text), 4 MiB of random JSON objects (JSON), 4 MiB of random log lines
(logs), 0.37 MiB of source from this repository (source), 3.96 MiB of H.264
video decoded to raw YUV420 frames (video), a 0.21 MiB JPEG, a 4 MiB slice of a
JDK source zip, and 4 MiB of `crypto.randomBytes`. Ratios below 0.95 are
compressed; the rest are stored raw.

| Sample    | Bytes | Brotli q1 ratio | Encode MiB/s | Decode MiB/s | Stored     |
| --------- | ----: | --------------: | -----------: | -----------: | ---------- |
| text      |  4.00 |           0.215 |          454 |          434 | compressed |
| JSON      |  4.00 |           0.263 |          379 |          442 | compressed |
| logs      |  4.00 |           0.211 |          431 |          339 | compressed |
| source    |  0.37 |           0.248 |          325 |          438 | compressed |
| raw video |  3.96 |           0.122 |          660 |          477 | compressed |
| JPEG      |  0.21 |           0.960 |          261 |          409 | raw        |
| ZIP       |  4.00 |           0.988 |          505 |          456 | raw        |
| random    |  4.00 |           1.000 |          836 |         1388 | raw        |

## Codec choice

Deflate at level 1 was the alternative. It compressed text-like data to similar
ratios (text 0.224, JSON 0.273, logs 0.214, source 0.264, raw video 0.137) but
was slower on incompressible input (ZIP 61 MiB/s, JPEG 62 MiB/s, random 53 MiB/s)
because it keeps searching for matches. Brotli quality 1 is faster on every
sample, compresses the text-like samples to fewer bytes, and is faster to
decode. One codec also keeps the flags byte simple: there is no second codec
identifier to carry or migrate.

Higher brotli qualities saved little more on these samples and cost two to four
times the CPU, so the server stays at quality 1. Chunks under 4 KiB stay raw
because the saved bytes are negligible next to the codec call. An 85 KiB start
probe decides whether to stream raw or buffer for compression. Only a chunk that
clears the probe is buffered and compressed; the full result must still save 5%
or it is stored raw.

Brotli output is deterministic for a fixed Node and brotli version. A Node or
brotli upgrade can change the stored bytes and SHA-1, so the same raw chunk may
be stored again instead of deduplicating after an upgrade.

## Why a threshold

JPEG and ZIP are already compressed. Re-encoding them saves about 4% and 1%
respectively, which is below the 5% floor, so those chunks keep their original
bytes. The stored BMP and the SHA-1 that is looked up and committed therefore
match the raw upload, avoiding a rewrite for a gain that does not pay for the
CPU.

## End-to-end

The repository performance suite is the end-to-end check. `bmp-stream` enables
compression, so it measures that path. The upload cases keep the default off, so
they measure the raw streaming path. The fixtures are repeated bytes; use the
per-type table above for realistic media. Baseline and phase 1 runs used the
same machine, Node v24.11.1, two warm-ups and five samples. The raw run is kept
with the session artifacts.

| Case                | Baseline ms | Phase 1 ms | Change | Phase 1 throughput |
| ------------------- | ----------: | ---------: | -----: | -----------------: |
| `bmp-stream`        |      217.12 |     214.62 |  -1.2% |          866 MiB/s |
| `upload-many`       |      333.41 |     310.13 |  -7.0% |           60 MiB/s |
| `upload-large`      |     2721.87 |    2645.61 |  -2.8% |          141 MiB/s |
| `upload-boundaries` |     7250.13 |    6984.61 |  -3.7% |          133 MiB/s |
| `upload-mixed-1`    |     1974.62 |    1684.66 | -14.7% |          132 MiB/s |
| `upload-mixed-4`    |     1681.87 |    1684.97 |  +0.2% |          133 MiB/s |
| `upload-mixed-8`    |     1721.68 |    1705.48 |  -1.0% |          131 MiB/s |
| `upload-mixed-32`   |     1719.26 |    1711.71 |  -0.4% |          130 MiB/s |
| `upload-tiny`       |        3.59 |       3.76 |  +4.7% |          0.3 MiB/s |

`bmp-stream` runs with `compress: true` so it measures the compression path.
The upload cases run with the default off and stay close to the baseline.
Throughput counts original input bytes, so a compressing upload moves fewer
bytes over the network than the number suggests.

Peak process RSS for `bmp-stream` is 1193.5 MiB with compression and 1011.9 MiB
on the raw streaming path, a 181.6 MiB increase for one 195 MB chunk. This is a
floor from a constant-fill fixture; mixed content can use more. Worst case per
buffered slot: a chunk that only clears 5% holds about 186 MiB of raw bytes plus
roughly twice its compressed output. Raw uploads keep the baseline profile:
`upload-large` 1272.6 MiB and `upload-boundaries` 2574.7 MiB. The increase
applies only to chunks that are actually buffered for compression.
