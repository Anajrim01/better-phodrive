import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import {
    bytes,
    bytesField,
    message,
    nested,
    numberField,
    parse,
    utf8
} from '@madkarmaa/phodrive-core/server/protobuf';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { authResponse } from '../helpers/photos';

const EMAIL = 'cache@example.com';
const TOKEN = 'aas_et/cache';
const PAGE_URL = '18047484249733410717';

type ProbeCounts = { prepare: number; range: number };

function preparedDownload(mediaKey: string, sha1: string, url: string): Buffer {
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

test('the real capture lists through the page-scoped name filter', async () => {
    const body = await readFile(new URL('../fixtures/library-page.bin', import.meta.url));
    const root = (await parse(body)).unwrap();
    const page = (await parse((await bytes(root, 1)).unwrap())).unwrap();
    const items = page.filter((field) => field.number === 2 && typeof field.value !== 'number');
    const candidates = new Map<string, string>();

    for (const item of items) {
        const entry = (await parse(item.value as Buffer)).unwrap();
        const mediaKey = (await bytes(entry, 1)).unwrap().toString('utf8');
        const sha1 = (await nested(item.value as Buffer, 2, 13, 1)).unwrap().toString('hex');

        candidates.set(mediaKey, sha1);
    }

    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url === 'https://android.googleapis.com/auth') return authResponse();
        if (url.includes(PAGE_URL)) return new Response(new Uint8Array(body));
        if (url.includes('PhotosPrepareDownload')) {
            counts.prepare++;
            const request = Buffer.from(await new Response(init?.body).arrayBuffer());
            const mediaKey = (await nested(request, 1, 1, 1)).andThen(utf8).unwrap();
            const sha1 = candidates.get(mediaKey);
            if (!sha1) throw new Error('Missing fixture item');

            return new Response(
                Uint8Array.from(
                    preparedDownload(
                        mediaKey,
                        sha1,
                        `https://lh3.googleusercontent.com/p/${mediaKey}=d`
                    )
                )
            );
        }

        counts.range++;

        return new Response('not a bmp');
    };

    const listed = await listBmps(EMAIL, TOKEN, '', fetcher);

    expect(listed.isOk()).toBe(true);
    expect(listed.unwrap().items).toEqual([]);
    expect(counts).toEqual({ prepare: 4, range: 4 });
});
