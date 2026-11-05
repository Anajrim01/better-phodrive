import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { parseLibraryPage } from '@madkarmaa/phodrive-core/server/photos/library/metadata';
import { expect, test } from 'vitest';
import { AUTH_URL, EMAIL, FILE_HASH, fingerprint, libraryFixture, TOKEN } from '../helpers/library';
import { authResponse, bytes, num } from '../helpers/protobuf';

test('listing marks a full hidden item as trashed and omits key-only hidden items', () => {
    const details = Buffer.concat([
        bytes(4, 'deleted.bmp'),
        num(9, 1),
        num(10, 120),
        bytes(13, bytes(1, Buffer.alloc(20, 1))),
        bytes(16, num(3, 1))
    ]);
    const trashedItem = bytes(2, Buffer.concat([bytes(1, 'trashed-key'), bytes(2, details)]));
    const keyOnlyItem = bytes(
        2,
        Buffer.concat([bytes(1, 'key-only'), bytes(2, bytes(16, num(3, 1)))])
    );
    const page = bytes(1, Buffer.concat([trashedItem, keyOnlyItem]));
    const parsed = parseLibraryPage(page).unwrap();

    expect(parsed.items).toEqual([
        expect.objectContaining({ mediaKey: 'trashed-key', size: 120, trashed: true })
    ]);
});

test('malformed library protobuf returns Err without throwing', async () => {
    let call = 0;
    const fakeFetch: Fetcher = async () =>
        ++call === 1 ? authResponse() : new Response(Uint8Array.from([10, 5, 1]));
    const result = await listBmps(EMAIL, TOKEN, '', fakeFetch);
    expect(result.isErr()).toBe(true);
    expect(result.match({ Ok: () => '', Err: (error) => error.message })).toContain(
        'Truncated protobuf'
    );
});

test.each([false, true])(
    'library discovers file pages and hides empty continuations (empty final page: %s)',
    async (emptyFinalPage) => {
        const { first, last, calls, fetcher } = libraryFixture(emptyFinalPage);
        const chunk = { fileHash: FILE_HASH, fileId: FILE_HASH, at: 42 };

        const firstResult = await listBmps(EMAIL, TOKEN, '', fetcher);
        const firstItems = firstResult.unwrap();
        expect(firstItems.items).toEqual([
            {
                ...chunk,
                originalName: 'original.bin',
                chunkIndex: 0,
                isLast: false,
                size: 2,
                mediaKey: 'renamed-first',
                sha1: fingerprint(first).toString('hex')
            }
        ]);
        expect(firstItems.nextPageToken).toBe(
            emptyFinalPage ? '' : Buffer.from('next-page').toString('base64url')
        );
        expect(calls.library).toBe(3);

        if (!emptyFinalPage) {
            const secondResult = await listBmps(EMAIL, TOKEN, firstItems.nextPageToken, fetcher);
            expect(secondResult.unwrap().items).toEqual([
                {
                    ...chunk,
                    originalName: undefined,
                    chunkIndex: 1,
                    isLast: true,
                    size: 1,
                    mediaKey: 'renamed-last',
                    sha1: fingerprint(last).toString('hex')
                }
            ]);
            expect(calls.library).toBe(4);
            expect(calls.prefix).toBe(4);
        }

        calls.failPrefix = true;
        const failedRefresh = await listBmps(EMAIL, TOKEN, '', fetcher);
        expect(failedRefresh.unwrapErr().message).toBe('Could not inspect photo header');
    }
);

test('library lookahead propagates failures and rejects repeated continuation tokens', async () => {
    let failContinuation = false;
    let libraryCalls = 0;
    const fakeFetch: Fetcher = async (input) => {
        if (String(input).includes(AUTH_URL)) return authResponse();

        libraryCalls++;
        if (failContinuation && libraryCalls > 1) return new Response(null, { status: 503 });

        return new Response(Uint8Array.from(bytes(1, bytes(1, 'repeat-page'))));
    };

    const repeated = await listBmps(EMAIL, TOKEN, '', fakeFetch);

    expect(repeated.unwrapErr().code).toBe('REPEATED_LIBRARY_PAGE');
    expect(libraryCalls).toBe(2);

    libraryCalls = 0;
    failContinuation = true;
    const failed = await listBmps(EMAIL, TOKEN, '', fakeFetch);

    expect(failed.unwrapErr().message).toBe('Library list failed (HTTP 503)');
    expect(libraryCalls).toBe(2);
});
