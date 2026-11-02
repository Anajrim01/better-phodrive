import { describe, expect, it } from 'vitest';
import { createApi } from '../src/api';

const MEDIA_URL = 'https://lh3.googleusercontent.com/pw/token-abcdefghijklmnop';

describe('byte API client', () => {
    it('forwards an abort signal to the in-flight fetch and body', async () => {
        const controller = new AbortController();
        const fetchImpl: typeof fetch = async (_input, init) => {
            const body = new ReadableStream<Uint8Array>({
                start(output) {
                    init?.signal?.addEventListener('abort', () => {
                        output.error(new DOMException('Aborted', 'AbortError'));
                    });
                }
            });

            return new Response(body, {
                status: 206,
                headers: { 'content-range': 'bytes 0-1/2' }
            });
        };
        const api = createApi(fetchImpl);
        const response = await api.fetchBytes(MEDIA_URL, 'bytes=0-1', controller.signal).unwrap();
        const reader = response.body.getReader();
        const pending = reader.read();
        controller.abort();

        await expect(pending).rejects.toThrow();
    });

    it('maps an aborted fetch to a cancelled failure', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchImpl: typeof fetch = async () => {
            throw new DOMException('Aborted', 'AbortError');
        };
        const api = createApi(fetchImpl);
        const failure = await api.fetchBytes(MEDIA_URL, 'bytes=0-1', controller.signal).unwrapErr();

        expect(failure.code).toBe('cancelled');
    });
});
