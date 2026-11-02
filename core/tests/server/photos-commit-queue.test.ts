import { afterEach, expect, test, vi } from 'vitest';
import { commitBmpQueued } from '../../src/server/photos/upload/commit-queue';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    bodyOf,
    commitItem,
    commitResponse,
    commitShape,
    expectCommitRequest
} from '../helpers/commit';

afterEach(() => {
    vi.useRealTimers();
    clearThrottleState();
});

test('a single commit waits for the batching window before it is sent', async () => {
    vi.useFakeTimers();
    const item = commitItem('window.bin', 'window');
    let requests = 0;
    const fetcher: Fetcher = async (_input, init) => {
        requests++;
        const shape = commitShape(await bodyOf(init));

        return commitResponse(
            shape.items.map((entry) => ({ transfer: entry.transfer, key: 'key' }))
        );
    };

    const commit = commitBmpQueued(
        'window@example.com',
        item.name,
        item.sha1,
        item.transfer,
        {},
        fetcher
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toBe(0);

    await vi.advanceTimersByTimeAsync(10);
    const result = await commit;

    expect(requests).toBe(1);
    expect(result.unwrap()).toBe('key');
});

test('twenty queued commits flush as one request', async () => {
    const items = Array.from({ length: 20 }, (_, index) =>
        commitItem(`batch-${index}.bin`, `batch-${index}`)
    );
    const requests: Buffer[] = [];
    const fetcher: Fetcher = async (_input, init) => {
        const body = await bodyOf(init);
        requests.push(body);
        const shape = commitShape(body);

        return commitResponse(
            shape.items.map((entry) => ({ transfer: entry.transfer, key: `key-${entry.name}` }))
        );
    };

    const results = await Promise.all(
        items.map((item) =>
            commitBmpQueued('batch@example.com', item.name, item.sha1, item.transfer, {}, fetcher)
        )
    );

    expect(requests).toHaveLength(1);
    expectCommitRequest(requests[0], items);
    expect(results.map((result) => result.unwrap())).toEqual(
        items.map((item) => `key-${item.name}`)
    );
});

test.each([400, 413])('a %i batch falls back to one request per item', async (status) => {
    const items = Array.from({ length: 3 }, (_, index) =>
        commitItem(`fallback-${index}.bin`, `fallback-${index}`)
    );
    let requests = 0;
    const fetcher: Fetcher = async (_input, init) => {
        requests++;
        const shape = commitShape(await bodyOf(init));
        if (shape.items.length > 1) return new Response(null, { status });

        return commitResponse([{ transfer: shape.items[0].transfer, key: 'single-key' }]);
    };

    const results = await Promise.all(
        items.map((item) =>
            commitBmpQueued(
                `fallback-${status}@example.com`,
                item.name,
                item.sha1,
                item.transfer,
                {},
                fetcher
            )
        )
    );

    expect(requests).toBe(4);
    expect(results.map((result) => result.unwrap())).toEqual([
        'single-key',
        'single-key',
        'single-key'
    ]);
});

test('a throttled batch pauses every caller without fallback requests', async () => {
    const items = [
        commitItem('throttled-a.bin', 'throttled-a'),
        commitItem('throttled-b.bin', 'throttled-b')
    ];
    let requests = 0;
    const fetcher: Fetcher = async () => {
        requests++;

        return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
    };

    const results = await Promise.all(
        items.map((item) =>
            commitBmpQueued(
                'throttled@example.com',
                item.name,
                item.sha1,
                item.transfer,
                {},
                fetcher
            )
        )
    );

    expect(requests).toBe(1);
    expect(results.map((result) => result.unwrapErr())).toEqual([
        expect.objectContaining({ code: 'THROTTLED', retryAfterSeconds: 120 }),
        expect.objectContaining({ code: 'THROTTLED', retryAfterSeconds: 120 })
    ]);
});

test('account keys ignore email case and keep credentials exact', async () => {
    const requests: { authorization: string | null; names: string[] }[] = [];
    const fetcher: Fetcher = async (_input, init) => {
        const shape = commitShape(await bodyOf(init));
        requests.push({
            authorization: new Headers(init?.headers).get('authorization'),
            names: shape.items.map((entry) => entry.name)
        });

        return commitResponse(
            shape.items.map((entry) => ({ transfer: entry.transfer, key: `key-${entry.name}` }))
        );
    };
    const caseItems = [commitItem('case-a.bin', 'case-a'), commitItem('case-b.bin', 'case-b')];
    const caseResults = await Promise.all([
        commitBmpQueued(
            'User@example.com',
            caseItems[0].name,
            caseItems[0].sha1,
            caseItems[0].transfer,
            {},
            fetcher
        ),
        commitBmpQueued(
            'user@example.com',
            caseItems[1].name,
            caseItems[1].sha1,
            caseItems[1].transfer,
            {},
            fetcher
        )
    ]);

    expect(caseResults.map((result) => result.unwrap())).toEqual([
        'key-case-a.bin',
        'key-case-b.bin'
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].names).toEqual(['case-a.bin', 'case-b.bin']);

    const tokenItems = [commitItem('token-a.bin', 'token-a'), commitItem('token-b.bin', 'token-b')];
    const tokenResults = await Promise.all([
        commitBmpQueued(
            'USER@example.com',
            tokenItems[0].name,
            tokenItems[0].sha1,
            tokenItems[0].transfer,
            { Authorization: 'Bearer one' },
            fetcher
        ),
        commitBmpQueued(
            'User@example.com',
            tokenItems[1].name,
            tokenItems[1].sha1,
            tokenItems[1].transfer,
            { authorization: 'Bearer two' },
            fetcher
        )
    ]);

    expect(tokenResults.map((result) => result.unwrap())).toEqual([
        'key-token-a.bin',
        'key-token-b.bin'
    ]);
    expect(requests).toHaveLength(3);
    expect(
        requests
            .slice(1)
            .map((entry) => entry.authorization)
            .sort()
    ).toEqual(['Bearer one', 'Bearer two']);
});

test('aborting every caller after send leaves the shared commit request active', async () => {
    const items = [commitItem('sent-a.bin', 'sent-a'), commitItem('sent-b.bin', 'sent-b')];
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    let sharedSignal: AbortSignal | undefined;
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
        started = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    let finished!: () => void;
    const completed = new Promise<void>((resolve) => {
        finished = resolve;
    });
    let requests = 0;
    const fetcher: Fetcher = async (_input, init) => {
        requests++;
        sharedSignal = init?.signal ?? undefined;
        started();
        await held;
        const shape = commitShape(await bodyOf(init));
        finished();

        return commitResponse(
            shape.items.map((entry) => ({ transfer: entry.transfer, key: `key-${entry.name}` }))
        );
    };

    const commits = items.map((item, index) =>
        commitBmpQueued(
            'abort-after-send@example.com',
            item.name,
            item.sha1,
            item.transfer,
            {},
            fetcher,
            [firstAbort, secondAbort][index].signal
        )
    );
    await start;
    firstAbort.abort();
    secondAbort.abort();
    const results = await Promise.all(commits);

    expect(sharedSignal?.aborted).toBe(false);
    expect(results.map((result) => result.unwrapErr())).toEqual([
        expect.objectContaining({ code: 'REQUEST_FAILED' }),
        expect.objectContaining({ code: 'REQUEST_FAILED' })
    ]);

    release();
    await completed;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requests).toBe(1);
    expect(sharedSignal?.aborted).toBe(false);
});

test('a caller aborted before the window is not sent', async () => {
    vi.useFakeTimers();
    const item = commitItem('aborted.bin', 'aborted');
    const abort = new AbortController();
    let requests = 0;
    const fetcher: Fetcher = async () => {
        requests++;

        return commitResponse([]);
    };

    const commit = commitBmpQueued(
        'aborted@example.com',
        item.name,
        item.sha1,
        item.transfer,
        {},
        fetcher,
        abort.signal
    );
    abort.abort();
    await vi.advanceTimersByTimeAsync(10);
    const result = await commit;

    expect(requests).toBe(0);
    expect(result.unwrapErr()).toEqual({ code: 'REQUEST_FAILED', message: 'Commit canceled' });
});
