# Chunk compression measurements

The server compresses a chunk before BMP encoding and stores it only when the
result saves at least 5% of the original bytes. Brotli quality 1 is the codec.
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
because the saved bytes are negligible next to the codec call. A 256 KiB probe
decides whether to compress the rest of a larger chunk; incompressible media
exits after the probe instead of compressing the full 195 MB.

## Why a threshold

JPEG and ZIP are already compressed. Re-encoding them saves about 4% and 1%
respectively, which is below the 5% floor, so those chunks keep their original
bytes. The stored BMP and the SHA-1 that is looked up and committed therefore
match the raw upload, avoiding a rewrite for a gain that does not pay for the
CPU.

## End-to-end

The repository performance suite is the end-to-end check. Its upload fixtures
are highly compressible (repeated bytes), so they measure the compression path
rather than typical media. Baseline and phase 1 runs used the same machine,
Node v24.11.1, two warm-ups and five samples. The raw run is kept with the
session artifacts.

| Case                | Baseline ms | Phase 1 ms | Change | Phase 1 throughput |
| ------------------- | ----------: | ---------: | -----: | -----------------: |
| `bmp-stream`        |      217.12 |     307.98 | +41.8% |          604 MiB/s |
| `upload-many`       |      333.41 |     317.42 |  -4.8% |           59 MiB/s |
| `upload-large`      |     2721.87 |    2806.25 |  +3.1% |          133 MiB/s |
| `upload-boundaries` |     7250.13 |    6629.83 |  -8.6% |          140 MiB/s |
| `upload-mixed-1`    |     1974.62 |    1875.35 |  -5.0% |          119 MiB/s |
| `upload-mixed-4`    |     1681.87 |    1911.22 | +13.6% |          117 MiB/s |
| `upload-mixed-8`    |     1721.68 |    1661.20 |  -3.5% |          134 MiB/s |
| `upload-mixed-32`   |     1719.26 |    1646.84 |  -4.2% |          135 MiB/s |
| `upload-tiny`       |        3.59 |       3.79 |  +5.5% |          0.3 MiB/s |

Throughput counts original input bytes, so a compressing upload moves fewer
bytes over the network than the number suggests. `bmp-stream` isolates the cost:
encoding a 195 MB repetitive chunk now takes 308 ms instead of 217 ms, because
the server compresses and then hashes the stored bytes.

Peak process RSS rises where 195 MB chunks are buffered for compression:
`upload-large` 1271.9 to 1760.5 MiB, `upload-boundaries` 2585.0 to 3293.0 MiB,
and the mixed cases by roughly 170 to 220 MiB. The server reads one chunk before
choosing raw or compressed, which the streaming encoder did not do. In exchange
the stored item is smaller and the Google commit uses the stored bytes' SHA-1.
Small and unchanged cases stay within normal run-to-run variation.
