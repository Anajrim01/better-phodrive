import { expect, test } from 'vitest';
import { commitBmpMany } from '../../src/server/photos/upload/transfer';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    bodyOf,
    commitItem,
    commitResponse,
    commitShape,
    expectCommitRequest
} from '../helpers/commit';

const EMAIL = 'commit@example.com';

test('one request carries every media item and maps results by token', async () => {
    const items = [
        commitItem('first.bin', 'first'),
        commitItem('second.bin', 'second'),
        commitItem('third.bin', 'third')
    ];
    const requests: Buffer[] = [];
    const fetcher: Fetcher = async (_input, init) => {
        const body = await bodyOf(init);
        requests.push(body);
        const shape = commitShape(body);

        return commitResponse(
            [...shape.items].reverse().map((item) => ({
                transfer: item.transfer,
                key: `key-${item.name}`
            }))
        );
    };

    const outcome = await commitBmpMany(EMAIL, items, {}, fetcher);
    const results = outcome.unwrap();

    expect(requests).toHaveLength(1);
    expectCommitRequest(requests[0], items);
    expect(
        items.map((item) => results.get(item.transfer.scotty.toString('hex'))?.unwrap())
    ).toEqual(['key-first.bin', 'key-second.bin', 'key-third.bin']);
});

test('entries without a token map back in request order', async () => {
    const items = [commitItem('one.bin', 'one'), commitItem('two.bin', 'two')];
    const fetcher: Fetcher = async (_input, init) => {
        const shape = commitShape(await bodyOf(init));

        return commitResponse(
            shape.items.map((item, index) => ({
                transfer: item.transfer,
                key: `index-${index}`,
                token: false
            }))
        );
    };

    const outcome = await commitBmpMany(EMAIL, items, {}, fetcher);

    expect(
        items.map((item) => outcome.unwrap().get(item.transfer.scotty.toString('hex'))?.unwrap())
    ).toEqual(['index-0', 'index-1']);
});

test('tokenless entries map by response position alongside token entries', async () => {
    const items = [
        commitItem('zero.bin', 'zero'),
        commitItem('one.bin', 'one'),
        commitItem('two.bin', 'two')
    ];
    const fetcher: Fetcher = async (_input, init) => {
        const shape = commitShape(await bodyOf(init));

        return commitResponse([
            { transfer: shape.items[0].transfer, key: 'key-zero', token: false },
            { transfer: shape.items[1].transfer, key: 'key-one', token: false },
            { transfer: shape.items[2].transfer, key: 'key-two' }
        ]);
    };

    const outcome = await commitBmpMany(EMAIL, items, {}, fetcher);
    const results = outcome.unwrap();

    expect(
        items.map((item) => results.get(item.transfer.scotty.toString('hex'))?.unwrap())
    ).toEqual(['key-zero', 'key-one', 'key-two']);
});

test('a short tokenless response rejects positional mapping', async () => {
    const items = [
        commitItem('zero.bin', 'zero'),
        commitItem('one.bin', 'one'),
        commitItem('two.bin', 'two')
    ];
    const fetcher: Fetcher = async () =>
        commitResponse([
            { transfer: items[0].transfer, key: 'key-zero', token: false },
            { transfer: items[2].transfer, key: 'key-two', token: false }
        ]);

    const outcome = await commitBmpMany(EMAIL, items, {}, fetcher);

    expect(outcome.unwrapErr()).toEqual({
        code: 'COMMIT_TOKEN_MISMATCH',
        message: 'Commit token mismatch'
    });
});

test('mixed token and index entries cannot claim the same position', async () => {
    const items = [commitItem('first.bin', 'first'), commitItem('second.bin', 'second')];
    const fetcher: Fetcher = async () =>
        commitResponse([
            { transfer: items[0].transfer, key: 'position-key', token: false },
            { transfer: items[0].transfer, key: 'token-key' }
        ]);

    const outcome = await commitBmpMany(EMAIL, items, {}, fetcher);

    expect(outcome.unwrapErr()).toEqual({
        code: 'COMMIT_TOKEN_MISMATCH',
        message: 'Commit token mismatch'
    });
});

test('partial success keeps the rejected item error and the accepted item keys', async () => {
    const items = [
        commitItem('accepted.bin', 'accepted'),
        commitItem('rejected.bin', 'rejected'),
        commitItem('also-accepted.bin', 'also-accepted')
    ];
    const fetcher: Fetcher = async (_input, init) => {
        const shape = commitShape(await bodyOf(init));
        const accepted = shape.items.filter((item) => item.name !== 'rejected.bin');

        return commitResponse([
            ...accepted.map((item) => ({ transfer: item.transfer, key: `key-${item.name}` })),
            { transfer: transferOf(shape, 'rejected.bin'), status: 10 }
        ]);
    };

    const outcome = await commitBmpMany(EMAIL, items, {}, fetcher);

    expect(outcome.isOk()).toBe(true);
    const results = outcome.unwrap();
    expect(results.get(items[0].transfer.scotty.toString('hex'))?.unwrap()).toBe(
        'key-accepted.bin'
    );
    expect(results.get(items[1].transfer.scotty.toString('hex'))?.unwrapErr()).toEqual({
        code: 'COMMIT_REJECTED',
        message: 'Commit rejected'
    });
    expect(results.get(items[2].transfer.scotty.toString('hex'))?.unwrap()).toBe(
        'key-also-accepted.bin'
    );
});

test('an unknown response token rejects the whole batch mapping', async () => {
    const items = [commitItem('known.bin', 'known')];
    const fetcher: Fetcher = async () =>
        commitResponse([{ transfer: commitItem('other.bin', 'other').transfer, key: 'wrong' }]);

    const outcome = await commitBmpMany(EMAIL, items, {}, fetcher);

    expect(outcome.unwrapErr()).toEqual({
        code: 'COMMIT_TOKEN_MISMATCH',
        message: 'Commit token mismatch'
    });
});

function transferOf(shape: ReturnType<typeof commitShape>, name: string) {
    const item = shape.items.find((entry) => entry.name === name);
    if (!item) throw new Error(`missing ${name}`);

    return item.transfer;
}
