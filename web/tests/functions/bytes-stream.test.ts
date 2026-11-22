import { afterEach, expect, test, vi } from 'vitest';
import { MAX_CHUNK_PAYLOAD_BYTES } from '@madkarmaa/phodrive-core/bmp/format';
import { handleBytes } from '../../functions/_lib/bytes';
import { BYTES_IDLE_TIMEOUT_MS } from '../../functions/_lib/limits';
import {
    OFFSET,
    SECRET,
    TOTAL,
    bodyLength,
    capability,
    rangeResponse,
    rangedBody,
    request
} from '../helpers/edge';

test('streams ranges up to a full 195 MB payload', async () => {
    const sizes = [...[16, 32, 64, 128].map((mib) => mib * 1024 * 1024), 195_000_000];

    for (const size of sizes) {
        const token = await capability({ o: 300, p: size, n: size + 500 });
        const response = await handleBytes(request(token, `bytes=0-${size - 1}`), {
            secret: SECRET,
            fetch: async () => rangeResponse(size, rangedBody(size, 8), 300, size + 500)
        });

        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe(`bytes 0-${size - 1}/${size}`);
        expect(await bodyLength(response)).toBe(size);
    }
});

test('a body longer than the mapped range errors instead of leaking bytes', async () => {
    const token = await capability();
    const response = await handleBytes(request(token, 'bytes=0-9'), {
        secret: SECRET,
        fetch: async () =>
            new Response(rangedBody(11), {
                status: 206,
                headers: { 'content-range': `bytes ${OFFSET}-${OFFSET + 9}/${TOTAL}` }
            })
    });

    await expect(bodyLength(response)).rejects.toThrow('exceeded its range');
});

test('cancels the upstream body when the viewer disconnects', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const token = await capability();
    const response = await handleBytes(request(token, 'bytes=0-999'), {
        secret: SECRET,
        fetch: async (_url, init) => {
            upstreamSignal = init?.signal ?? undefined;

            return rangeResponse(1_000);
        }
    });

    await response.body?.cancel();
    expect(upstreamSignal?.aborted).toBe(true);
});

afterEach(() => {
    vi.useRealTimers();
});

async function proxied(body: ReadableStream<Uint8Array>): Promise<Response> {
    const token = await capability();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    return handleBytes(request(token, 'bytes=0-999'), {
        secret: SECRET,
        fetch: async () => rangeResponse(1_000, body)
    });
}

test('a slow viewer does not trip the upstream idle timeout', async () => {
    const response = await proxied(rangedBody(1_000, 4));

    await vi.advanceTimersByTimeAsync(BYTES_IDLE_TIMEOUT_MS * 3);

    expect(await bodyLength(response)).toBe(1_000);
});

test('upstream that never answers is aborted by the idle timeout', async () => {
    const token = await capability();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        fetchStarted = resolve;
    });
    const pending = handleBytes(request(token, 'bytes=0-999'), {
        secret: SECRET,
        fetch: (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                fetchStarted();
            })
    });
    await started;
    await vi.advanceTimersByTimeAsync(BYTES_IDLE_TIMEOUT_MS);

    expect((await pending).status).toBe(502);
});

test('a stalled upstream read trips the idle timeout', async () => {
    const response = await proxied(new ReadableStream<Uint8Array>());
    const reading = response.body!.getReader().read();
    const outcome = expect(reading).rejects.toThrow('Upstream body timed out');

    await vi.advanceTimersByTimeAsync(BYTES_IDLE_TIMEOUT_MS);

    await outcome;
});

test('one request per full 195 MB chunk keeps the Worker budget predictable', () => {
    const chunks = (bytes: number) => Math.ceil(bytes / MAX_CHUNK_PAYLOAD_BYTES);

    expect(chunks(100_000_000)).toBe(1);
    expect(chunks(1_000_000_000)).toBe(6);
    expect(chunks(5_000_000_000)).toBe(26);
});
