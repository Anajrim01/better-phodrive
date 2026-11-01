import { createHash } from 'node:crypto';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    bytesField,
    message,
    nested,
    numberField,
    utf8
} from '@madkarmaa/phodrive-core/server/protobuf';

export const PAGE_URL = '18047484249733410717';
export const PREPARE_URL = 'PhotosPrepareDownload';
export const DOWNLOAD_HOST = 'https://lh3.googleusercontent.com';
export const PAGE_SIZE = 200;
export const SYNC_ONE = 'sync-one';
export const SYNC_TWO = 'sync-two';

export type Counts = { auth: number; page: number; delta: number; prepare: number; range: number };

export type Item = {
    mediaKey: string;
    sha1: string;
    size: number;
    at: number;
    fileName: string;
    bmp: Buffer;
};

export function chunkItem(index: number): Item {
    const payload = Uint8Array.of(index % 251, (index + 1) % 251);
    const fileHash = createHash('sha256').update(`file-${index}`).digest('hex');
    const fileName = `file-${index}.bin`;
    const bmp = Buffer.from(
        encodeSplitBmp(payload, {
            fileHash,
            fileId: fileHash,
            chunkIndex: 0,
            flags: 1,
            payloadSize: payload.length,
            fileName
        }).unwrap()
    );

    return {
        mediaKey: `chunk-${index}`,
        sha1: createHash('sha1').update(bmp).digest('hex'),
        size: bmp.length,
        at: index,
        fileName: `${fileName}.phodrive-${fileHash}-0-of-1.bmp`,
        bmp
    };
}

export function pageBytes(
    items: readonly Item[],
    nextToken: string,
    options: { syncToken?: string; deleted?: readonly string[] } = {}
): Buffer {
    const entries = items.map((item) =>
        bytesField(
            2,
            message(
                bytesField(1, item.mediaKey),
                bytesField(
                    2,
                    message(
                        bytesField(4, item.fileName),
                        numberField(9, item.at),
                        numberField(10, item.size),
                        bytesField(13, message(bytesField(1, Buffer.from(item.sha1, 'hex'))))
                    )
                )
            )
        )
    );
    const deletions = (options.deleted ?? []).map((mediaKey) =>
        bytesField(
            9,
            message(
                bytesField(
                    1,
                    message(numberField(1, 1), bytesField(2, message(bytesField(1, mediaKey))))
                )
            )
        )
    );

    return bytesField(
        1,
        message(
            bytesField(1, nextToken),
            ...entries,
            ...deletions,
            ...(options.syncToken ? [bytesField(6, options.syncToken)] : [])
        )
    );
}

function prepareResponse(item: Item): Buffer {
    const url = `${DOWNLOAD_HOST}/p/${item.mediaKey}=d`;
    const image = message(bytesField(5, url));
    const download = message(numberField(1, 1), bytesField(2, image));

    return bytesField(
        1,
        message(
            bytesField(1, item.mediaKey),
            bytesField(
                2,
                message(bytesField(13, message(bytesField(1, Buffer.from(item.sha1, 'hex')))))
            ),
            bytesField(5, download)
        )
    );
}

async function requestTokens(
    body: BodyInit | null | undefined
): Promise<{ resume: string; sync: string }> {
    const raw = Buffer.from(await new Response(body).arrayBuffer());

    return {
        resume: nested(raw, 1, 4).match({ Ok: (value) => value.toString(), Err: () => '' }),
        sync: nested(raw, 1, 6).match({ Ok: (value) => value.toString(), Err: () => '' })
    };
}

export function fetcherFor(
    items: readonly Item[],
    pages: readonly Buffer[],
    counts: Counts,
    options: { delta: Buffer; rejectDelta?: boolean }
): Fetcher {
    const byKey = new Map(items.map((item) => [item.mediaKey, item]));

    return async (input, init) => {
        const url = String(input);

        if (url === 'https://android.googleapis.com/auth') {
            counts.auth++;

            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        }

        if (url.includes(PAGE_URL)) {
            const tokens = await requestTokens(init?.body);
            if (tokens.sync) {
                counts.delta++;
                if (options.rejectDelta) return new Response(null, { status: 400 });

                return new Response(new Uint8Array(options.delta));
            }

            counts.page++;
            const index = tokens.resume ? Number(tokens.resume.replace('page-', '')) : 0;

            return new Response(new Uint8Array(pages[index]));
        }

        if (url.includes(PREPARE_URL)) {
            counts.prepare++;
            const request = Buffer.from(await new Response(init?.body).arrayBuffer());
            const mediaKey = nested(request, 1, 1, 1).andThen(utf8).unwrap();
            const item = byKey.get(mediaKey);
            if (!item) throw new Error('Missing probe item');

            return new Response(new Uint8Array(prepareResponse(item)));
        }

        if (url.startsWith(DOWNLOAD_HOST)) {
            counts.range++;
            const mediaKey = url.split('/p/')[1]?.replace('=d', '') ?? '';
            const item = byKey.get(mediaKey);
            if (!item) throw new Error('Missing probe body');

            return new Response(new Uint8Array(item.bmp), { status: 206 });
        }

        throw new Error(`Unexpected request ${url}`);
    };
}

export function pagesOf(items: readonly Item[]): Buffer[] {
    const pageCount = Math.ceil(items.length / PAGE_SIZE);

    return Array.from({ length: pageCount }, (_, index) =>
        pageBytes(
            items.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
            index + 1 < pageCount ? `page-${index + 1}` : '',
            index === 0 ? { syncToken: SYNC_ONE } : {}
        )
    );
}

export function emptyCounts(): Counts {
    return { auth: 0, page: 0, delta: 0, prepare: 0, range: 0 };
}
