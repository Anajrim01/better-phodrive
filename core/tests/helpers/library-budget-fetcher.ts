import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { nested } from '@madkarmaa/phodrive-core/server/protobuf';
import { authResponse, bytes, downloadMetadata, imageDownload, num } from './protobuf';
import type { BudgetItem } from './library-budget';

const LIBRARY_RPC = '18047484249733410717';
const DOWNLOAD_HOST = 'https://lh3.googleusercontent.com';

export type RequestCounts = {
    auth: number;
    library: number;
    prepare: number;
    media: number;
};

export function emptyCounts(): RequestCounts {
    return { auth: 0, library: 0, prepare: 0, media: 0 };
}

function videoDownload(): Buffer {
    return Buffer.concat([num(1, 2), bytes(3, bytes(5, 'video-download'))]);
}

export function budgetFetcher(
    pages: ReadonlyMap<string, Buffer>,
    items: readonly BudgetItem[],
    counts: RequestCounts
): Fetcher {
    const byKey = new Map(items.map((item) => [item.mediaKey, item]));

    const libraryPage = async (body: BodyInit | null | undefined) => {
        const requestBytes = await new Response(body).arrayBuffer();
        const pageToken = nested(Buffer.from(requestBytes), 1, 4).match({
            Ok: (value) => value.toString(),
            Err: () => ''
        });
        const page = pages.get(pageToken);
        if (!page) throw new Error(`Missing library page ${pageToken}`);
        counts.library++;

        return new Response(Uint8Array.from(page));
    };

    const prepareDownload = async (body: BodyInit | null | undefined) => {
        const requestBytes = await new Response(body).arrayBuffer();
        const request = Buffer.from(requestBytes);
        const mediaKey = nested(request, 1, 1, 1).match({
            Ok: (value) => value.toString(),
            Err: () => ''
        });
        const item = byKey.get(mediaKey);
        if (!item) throw new Error(`Missing prepare item ${mediaKey}`);

        counts.prepare++;

        const download = item.video
            ? videoDownload()
            : imageDownload(`${DOWNLOAD_HOST}/p/${item.mediaKey}=d`);

        return new Response(
            Uint8Array.from(
                downloadMetadata(item.mediaKey, Buffer.from(item.sha1, 'hex'), download)
            )
        );
    };

    const photoPrefix = (url: string, headers: HeadersInit | undefined) => {
        const key = url.split('/').pop()?.replace('=d', '') ?? '';
        const item = byKey.get(key);
        if (!item) throw new Error('Missing photo');
        if (new Headers(headers).get('range') !== 'bytes=0-65535')
            throw new Error('Unexpected range');
        counts.media++;

        return new Response(Uint8Array.from(item.bmp), { status: 206 });
    };

    return async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) {
            counts.auth++;

            return authResponse();
        }
        if (url.includes(LIBRARY_RPC)) return await libraryPage(init?.body);
        if (url.includes('PhotosPrepareDownload')) return await prepareDownload(init?.body);

        return photoPrefix(url, init?.headers);
    };
}
