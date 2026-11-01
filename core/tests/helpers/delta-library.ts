import { createHash } from 'node:crypto';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    bytesField,
    message,
    nested,
    numberField,
    parse,
    utf8
} from '@madkarmaa/phodrive-core/server/protobuf';

export const PAGE_URL = '18047484249733410717';
export const RESTORE_URL = '17490284929287180316';
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
    const fileId = fileIdentity(fileName, fileHash);
    const bmp = Buffer.from(
        encodeSplitBmp(payload, {
            fileHash,
            fileId,
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

export function fileChunk(fileIndex: number, chunkIndex: number, count: number, folder = ''): Item {
    const payload = Uint8Array.of(
        fileIndex % 251,
        chunkIndex % 251,
        (fileIndex + chunkIndex + 1) % 251
    );
    const fileHash = createHash('sha256').update(`file-${fileIndex}`).digest('hex');
    const fileName = `file-${fileIndex}.bin`;
    const fileId = fileIdentity(fileName, fileHash, undefined, folder);
    const bmp = Buffer.from(
        encodeSplitBmp(payload, {
            fileHash,
            fileId,
            chunkIndex,
            flags: chunkIndex === count - 1 ? 1 : 0,
            payloadSize: payload.length,
            ...(chunkIndex === 0 ? { fileName, ...(folder ? { folder } : {}) } : {})
        }).unwrap()
    );

    return {
        mediaKey: `chunk-${fileIndex}-${chunkIndex}`,
        sha1: createHash('sha1').update(bmp).digest('hex'),
        size: bmp.length,
        at: fileIndex,
        fileName: `${fileName}.phodrive-${fileHash}-${chunkIndex}-of-${count}.bmp`,
        bmp
    };
}

function pageEntry(item: Item, trashed: boolean): Buffer {
    const details = message(
        bytesField(4, item.fileName),
        numberField(9, item.at),
        numberField(10, item.size),
        bytesField(13, message(bytesField(1, Buffer.from(item.sha1, 'hex')))),
        ...(trashed ? [bytesField(16, message(numberField(3, 1)))] : [])
    );

    return bytesField(2, message(bytesField(1, item.mediaKey), bytesField(2, details)));
}

export function pageBytes(
    items: readonly Item[],
    nextToken: string,
    options: {
        syncToken?: string;
        deleted?: readonly string[];
        trashed?: readonly (string | Item)[];
    } = {}
): Buffer {
    const entries = items.map((item) => pageEntry(item, false));
    const trashed = (options.trashed ?? []).map((entry) =>
        typeof entry === 'string'
            ? bytesField(
                  2,
                  message(
                      bytesField(1, entry),
                      bytesField(2, message(bytesField(16, message(numberField(3, 1)))))
                  )
              )
            : pageEntry(entry, true)
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
            ...trashed,
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

export type LibraryRequestTokens = {
    resume: string;
    hasResume: boolean;
    sync: string;
};

async function requestTokens(body: BodyInit | null | undefined): Promise<LibraryRequestTokens> {
    const raw = Buffer.from(await new Response(body).arrayBuffer());
    const resume = nested(raw, 1, 4);

    return {
        resume: resume.match({ Ok: (value) => value.toString(), Err: () => '' }),
        hasResume: resume.isOk(),
        sync: nested(raw, 1, 6).match({ Ok: (value) => value.toString(), Err: () => '' })
    };
}

export function fetcherFor(
    items: readonly Item[],
    pages: readonly Buffer[],
    counts: Counts,
    options: {
        delta: Buffer | ((tokens: LibraryRequestTokens) => Buffer);
        deltaStatus?: number;
        prepareStatus?: number;
        restoreStatus?: number | ((sha1s: readonly string[]) => number | undefined);
        restoreRequests?: string[][];
    }
): Fetcher {
    const byKey = new Map(items.map((item) => [item.mediaKey, item]));

    return async (input, init) => {
        const url = String(input);

        if (url === 'https://android.googleapis.com/auth') {
            counts.auth++;

            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        }

        if (url.includes(RESTORE_URL)) {
            const request = Buffer.from(await new Response(init?.body).arrayBuffer());
            const sha1s: string[] = [];
            for (const field of parse(request).unwrap()) {
                if (field.number !== 3 || !Buffer.isBuffer(field.value)) continue;

                sha1s.push(Buffer.from(field.value.toString(), 'base64url').toString('hex'));
            }
            options.restoreRequests?.push(sha1s);

            const status =
                typeof options.restoreStatus === 'function'
                    ? options.restoreStatus(sha1s)
                    : options.restoreStatus;
            if (status)
                return new Response(null, {
                    status,
                    headers: status === 429 ? { 'retry-after': '9' } : undefined
                });

            return new Response(new Uint8Array());
        }

        if (url.includes(PAGE_URL)) {
            const tokens = await requestTokens(init?.body);
            if (tokens.sync) {
                counts.delta++;
                if (options.deltaStatus)
                    return new Response(null, {
                        status: options.deltaStatus,
                        headers: { 'retry-after': '9' }
                    });

                const delta =
                    typeof options.delta === 'function' ? options.delta(tokens) : options.delta;

                return new Response(new Uint8Array(delta));
            }

            counts.page++;
            const index = tokens.resume ? Number(tokens.resume.replace('page-', '')) : 0;

            return new Response(new Uint8Array(pages[index]));
        }

        if (url.includes(PREPARE_URL)) {
            counts.prepare++;
            if (options.prepareStatus) return new Response(null, { status: options.prepareStatus });

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
