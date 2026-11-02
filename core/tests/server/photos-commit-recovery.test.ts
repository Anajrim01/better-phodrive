import { afterEach, expect, test } from 'vitest';
import { commitBmpQueued } from '../../src/server/photos/upload/commit-queue';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { bodyOf, commitItem, commitResponse, commitShape } from '../helpers/commit';
import { batchResponse, requestShape as lookupRequestShape } from '../helpers/lookup';

afterEach(clearThrottleState);

test('a timed out batch reconciles by hash before retrying only the missing item', async () => {
    const items = [commitItem('found.bin', 'found'), commitItem('missing.bin', 'missing')];
    let commits = 0;
    let lookups = 0;
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('5084965799730810217')) {
            lookups++;
            const hashes = lookupRequestShape(await bodyOf(init)).hashes;

            return batchResponse(
                hashes.map((hash) => ({
                    sha1: hash,
                    key: hash.equals(items[0].sha1) ? 'found-key' : undefined
                }))
            );
        }

        commits++;
        if (commits === 1) throw new TypeError('fetch failed');

        const shape = commitShape(await bodyOf(init));

        return commitResponse(
            shape.items.map((entry) => ({ transfer: entry.transfer, key: 'retried-key' }))
        );
    };

    const results = await Promise.all(
        items.map((item) =>
            commitBmpQueued('timeout@example.com', item.name, item.sha1, item.transfer, {}, fetcher)
        )
    );

    expect({ commits, lookups }).toEqual({ commits: 2, lookups: 1 });
    expect(results[0].unwrap()).toBe('found-key');
    expect(results[1].unwrap()).toBe('retried-key');
});

test('a partial response reconciles only the item without a result', async () => {
    const items = [commitItem('done.bin', 'done'), commitItem('partial.bin', 'partial')];
    let commits = 0;
    let lookups = 0;
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('5084965799730810217')) {
            lookups++;
            const hashes = lookupRequestShape(await bodyOf(init)).hashes;

            return batchResponse(hashes.map((hash) => ({ sha1: hash })));
        }

        commits++;
        const shape = commitShape(await bodyOf(init));
        if (commits === 1)
            return commitResponse([{ transfer: items[0].transfer, key: 'first-key' }]);

        return commitResponse(
            shape.items.map((entry) => ({ transfer: entry.transfer, key: 'partial-key' }))
        );
    };

    const results = await Promise.all(
        items.map((item) =>
            commitBmpQueued('partial@example.com', item.name, item.sha1, item.transfer, {}, fetcher)
        )
    );

    expect({ commits, lookups }).toEqual({ commits: 2, lookups: 1 });
    expect(results.map((result) => result.unwrap())).toEqual(['first-key', 'partial-key']);
});

test('a timed out single fallback reconciles by hash before settling', async () => {
    const items = [commitItem('ok.bin', 'ok'), commitItem('late.bin', 'late')];
    let commits = 0;
    let lookups = 0;
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('5084965799730810217')) {
            lookups++;
            const hashes = lookupRequestShape(await bodyOf(init)).hashes;

            return batchResponse(
                hashes.map((hash) => ({
                    sha1: hash,
                    key: hash.equals(items[1].sha1) ? 'late-key' : undefined
                }))
            );
        }

        commits++;
        const shape = commitShape(await bodyOf(init));
        if (shape.items.length > 1) return new Response(null, { status: 400 });
        if (shape.items[0].name === items[1].name) throw new TypeError('fetch failed');

        return commitResponse([{ transfer: shape.items[0].transfer, key: 'ok-key' }]);
    };

    const results = await Promise.all(
        items.map((item) =>
            commitBmpQueued(
                'fallback-timeout@example.com',
                item.name,
                item.sha1,
                item.transfer,
                {},
                fetcher
            )
        )
    );

    expect({ commits, lookups }).toEqual({ commits: 3, lookups: 1 });
    expect(results.map((result) => result.unwrap())).toEqual(['ok-key', 'late-key']);
});

test('an omitted hash lookup result stays uncertain instead of retrying', async () => {
    const items = [commitItem('found.bin', 'found'), commitItem('omitted.bin', 'omitted')];
    let commits = 0;
    let lookups = 0;
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('5084965799730810217')) {
            lookups++;

            return batchResponse([{ sha1: items[0].sha1, key: 'found-key' }]);
        }

        commits++;
        if (commits === 1) throw new TypeError('fetch failed');
        const shape = commitShape(await bodyOf(init));

        return commitResponse(
            shape.items.map((entry) => ({ transfer: entry.transfer, key: 'unexpected-key' }))
        );
    };

    const results = await Promise.all(
        items.map((item) =>
            commitBmpQueued(
                'lookup-omitted@example.com',
                item.name,
                item.sha1,
                item.transfer,
                {},
                fetcher
            )
        )
    );

    expect({ commits, lookups }).toEqual({ commits: 1, lookups: 1 });
    expect(results[0].unwrap()).toBe('found-key');
    expect(results[1].unwrapErr()).toEqual({
        code: 'COMMIT_OUTCOME_UNCERTAIN',
        message: 'Commit outcome uncertain. Check Google Photos before retrying.'
    });
});

test('a server failure reports an uncertain outcome for every item without retrying', async () => {
    const items = [commitItem('server-a.bin', 'server-a'), commitItem('server-b.bin', 'server-b')];
    let requests = 0;
    const fetcher: Fetcher = async () => {
        requests++;

        return new Response(null, { status: 500 });
    };

    const results = await Promise.all(
        items.map((item) =>
            commitBmpQueued('server@example.com', item.name, item.sha1, item.transfer, {}, fetcher)
        )
    );

    expect(requests).toBe(1);
    expect(results.map((result) => result.unwrapErr())).toEqual([
        expect.objectContaining({ code: 'COMMIT_OUTCOME_UNCERTAIN' }),
        expect.objectContaining({ code: 'COMMIT_OUTCOME_UNCERTAIN' })
    ]);
});

test('repeated server failures stay uncertain instead of becoming automatic retries', async () => {
    let requests = 0;
    const fetcher: Fetcher = async () => {
        requests++;

        return new Response(null, { status: 500 });
    };

    for (let round = 0; round < 3; round++) {
        const items = [
            commitItem(`server-${round}-a.bin`, `server-${round}-a`),
            commitItem(`server-${round}-b.bin`, `server-${round}-b`)
        ];
        const results = await Promise.all(
            items.map((item) =>
                commitBmpQueued(
                    'server-retry@example.com',
                    item.name,
                    item.sha1,
                    item.transfer,
                    {},
                    fetcher
                )
            )
        );

        expect(results.map((result) => result.unwrapErr())).toEqual([
            expect.objectContaining({ code: 'COMMIT_OUTCOME_UNCERTAIN' }),
            expect.objectContaining({ code: 'COMMIT_OUTCOME_UNCERTAIN' })
        ]);
    }

    expect(requests).toBe(3);
});

test('a single rejected item reports its own error while the batch succeeds', async () => {
    const items = [commitItem('good.bin', 'good'), commitItem('bad.bin', 'bad')];
    const fetcher: Fetcher = async (_input, init) => {
        const shape = commitShape(await bodyOf(init));

        return commitResponse([
            { transfer: items[0].transfer, key: 'good-key' },
            { transfer: items[1].transfer, status: 10 }
        ]);
    };

    const results = await Promise.all(
        items.map((item) =>
            commitBmpQueued('item@example.com', item.name, item.sha1, item.transfer, {}, fetcher)
        )
    );

    expect(results[0].unwrap()).toBe('good-key');
    expect(results[1].unwrapErr()).toEqual({
        code: 'COMMIT_REJECTED',
        message: 'Commit rejected'
    });
});
