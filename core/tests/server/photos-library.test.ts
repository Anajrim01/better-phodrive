import { expect, test } from 'vitest';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { nested } from '@madkarmaa/phodrive-core/server/protobuf';
import {
    authResponse,
    bytes,
    fingerprint,
    libraryFixture,
    libraryPrepareMetadata
} from '../helpers/photos';

test('malformed library protobuf returns Err without throwing', async () => {
    let call = 0;
    const fakeFetch: Fetcher = async () =>
        ++call === 1 ? authResponse() : new Response(Uint8Array.from([10, 5, 1]));
    const result = await listBmps('test@example.com', 'aas_et/test', '', fakeFetch);
    expect(result.isErr()).toBe(true);
    expect(result.match({ Ok: () => '', Err: (error) => error.message })).toContain(
        'Truncated protobuf'
    );
});

test.each([false, true])(
    'library discovers file pages and hides empty continuations (empty final page: %s)',
    async (emptyFinalPage) => {
        const { fileHash, first, last, originals, firstPage, continuationPage, syncPage } =
            libraryFixture();
        const secondPage = emptyFinalPage ? syncPage : continuationPage;
        let libraryCalls = 0;
        let prefixCalls = 0;
        let failPrefix = false;

        const fakeFetch: Fetcher = async (input, init) => {
            const url = String(input);
            if (url.includes('android.googleapis.com/auth')) return authResponse();

            if (url.includes('18047484249733410717')) {
                const requestBytes = await new Response(init?.body).arrayBuffer();
                const body = Buffer.from(requestBytes);
                libraryCalls++;
                const requestToken = nested(body, 1, 4).match({
                    Ok: (value) => value.toString(),
                    Err: () => ''
                });
                expect(['', 'empty-page', 'next-page']).toContain(requestToken);
                const response =
                    requestToken === ''
                        ? firstPage
                        : requestToken === 'empty-page'
                          ? bytes(1, bytes(1, 'next-page'))
                          : secondPage;
                return new Response(Uint8Array.from(response));
            }

            if (url.includes('PhotosPrepareDownload')) {
                const requestBytes = await new Response(init?.body).arrayBuffer();
                const request = Buffer.from(requestBytes);
                const entry = [...originals].find(([key]) => request.includes(Buffer.from(key)));
                if (!entry) throw new Error('Missing test item');

                const [key, data] = entry;
                return new Response(Uint8Array.from(libraryPrepareMetadata(key, data)));
            }

            const key = url.split('/').pop()?.replace('=d', '') ?? '';
            expect(key).not.toBe('ordinary-video');
            const data = originals.get(key);
            if (!data) throw new Error('Missing test photo');
            expect(new Headers(init?.headers).get('range')).toBe('bytes=0-65535');
            prefixCalls++;
            if (failPrefix && key === 'renamed-first') return new Response(null, { status: 503 });

            return new Response(Uint8Array.from(data), { status: 206 });
        };

        const firstResult = await listBmps('test@example.com', 'aas_et/test', '', fakeFetch);
        const firstItems = firstResult.unwrap();
        expect(firstItems.items).toEqual([
            {
                originalName: 'original.bin',
                fileHash,
                fileId: fileHash,
                chunkIndex: 0,
                isLast: false,
                size: 2,
                at: 42,
                mediaKey: 'renamed-first',
                sha1: fingerprint(first).toString('hex')
            }
        ]);

        expect(firstItems.nextPageToken).toBe(
            emptyFinalPage ? '' : Buffer.from('next-page').toString('base64url')
        );
        expect(libraryCalls).toBe(3);

        if (!emptyFinalPage) {
            const secondResult = await listBmps(
                'test@example.com',
                'aas_et/test',
                firstItems.nextPageToken,
                fakeFetch
            );
            expect(secondResult.unwrap().items).toEqual([
                {
                    originalName: undefined,
                    fileHash,
                    fileId: fileHash,
                    chunkIndex: 1,
                    isLast: true,
                    size: 1,
                    at: 42,
                    mediaKey: 'renamed-last',
                    sha1: fingerprint(last).toString('hex')
                }
            ]);
            expect(libraryCalls).toBe(4);
            expect(prefixCalls).toBe(3);
        }

        failPrefix = true;
        libraryCalls = 0;
        clearProbeCache();

        const failedRefresh = await listBmps('test@example.com', 'aas_et/test', '', fakeFetch);
        expect(failedRefresh.unwrapErr().message).toBe('Could not inspect photo header');
    }
);

test('library lookahead propagates failures and rejects repeated continuation tokens', async () => {
    let failContinuation = false;
    let libraryCalls = 0;
    const fakeFetch: Fetcher = async (input) => {
        if (String(input).includes('android.googleapis.com/auth')) return authResponse();

        libraryCalls++;
        if (failContinuation && libraryCalls > 1) return new Response(null, { status: 503 });

        return new Response(Uint8Array.from(bytes(1, bytes(1, 'repeat-page'))));
    };

    const repeated = await listBmps('test@example.com', 'aas_et/test', '', fakeFetch);

    expect(repeated.unwrapErr().code).toBe('REPEATED_LIBRARY_PAGE');
    expect(libraryCalls).toBe(2);

    libraryCalls = 0;
    failContinuation = true;
    const failed = await listBmps('test@example.com', 'aas_et/test', '', fakeFetch);

    expect(failed.unwrapErr().message).toBe('Library list failed (HTTP 503)');
    expect(libraryCalls).toBe(2);
});
