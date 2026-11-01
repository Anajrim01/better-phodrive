import { createHash } from 'node:crypto';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { bytesField, message, numberField } from '@madkarmaa/phodrive-core/server/protobuf';

export const PAGE_URL = '18047484249733410717';
export const PREPARE_URL = 'PhotosPrepareDownload';
export const DOWNLOAD_HOST = 'https://lh3.googleusercontent.com';

export type ProbeCounts = { prepare: number; range: number };

export function libraryPage(
    items: { mediaKey: string; sha1: string; size: number; at: number; fileName?: string }[]
): Buffer {
    const entries = items.map((item) => {
        const details = message(
            numberField(9, item.at),
            numberField(10, item.size),
            bytesField(13, message(bytesField(1, Buffer.from(item.sha1, 'hex')))),
            ...(item.fileName ? [bytesField(4, item.fileName)] : [])
        );

        return bytesField(2, message(bytesField(1, item.mediaKey), bytesField(2, details)));
    });

    return bytesField(1, message(...entries));
}

export function preparedDownload(mediaKey: string, sha1: string, url: string): Buffer {
    const image = message(bytesField(5, url));
    const download = message(numberField(1, 1), bytesField(2, image));

    return bytesField(
        1,
        message(
            bytesField(1, mediaKey),
            bytesField(
                2,
                message(bytesField(13, message(bytesField(1, Buffer.from(sha1, 'hex')))))
            ),
            bytesField(5, download)
        )
    );
}

export function videoDownload(mediaKey: string, sha1: string): Buffer {
    const download = message(numberField(1, 2), bytesField(3, message()));

    return bytesField(
        1,
        message(
            bytesField(1, mediaKey),
            bytesField(
                2,
                message(bytesField(13, message(bytesField(1, Buffer.from(sha1, 'hex')))))
            ),
            bytesField(5, download)
        )
    );
}

export function fixture(name: string, payload: string) {
    const bytes = Buffer.from(payload);
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    const bmp = encodeSplitBmp(bytes, {
        fileHash,
        fileId: fileHash,
        chunkIndex: 0,
        flags: 1,
        payloadSize: bytes.length,
        fileName: name
    }).unwrap();

    return {
        mediaKey: `media-${fileHash.slice(0, 8)}`,
        sha1: createHash('sha1').update(bmp).digest('hex'),
        size: bmp.length,
        at: 1,
        bmp,
        trashed: false
    };
}

export function fetcherFor(
    page: Buffer,
    prepared: { mediaKey: string; sha1: string; url: string },
    body: Response | (() => Response),
    counts: ProbeCounts
): Fetcher {
    return async (input) => {
        const url = String(input);
        if (url === 'https://android.googleapis.com/auth')
            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);

        if (url.includes(PAGE_URL)) return new Response(new Uint8Array(page));

        if (url.includes(PREPARE_URL)) {
            counts.prepare++;
            return new Response(
                new Uint8Array(preparedDownload(prepared.mediaKey, prepared.sha1, prepared.url))
            );
        }

        if (url.startsWith(DOWNLOAD_HOST)) {
            counts.range++;
            return typeof body === 'function' ? body() : body;
        }

        throw new Error(`Unexpected request ${url}`);
    };
}
