import { expect, test } from 'vitest';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { parseAccountState } from '@madkarmaa/phodrive-core/server/photos/library/state-parse';

const ITEM: RemoteBmp = {
    fileHash: 'a'.repeat(64),
    fileId: 'a'.repeat(64),
    chunkIndex: 0,
    isLast: true,
    originalName: 'proof.bin',
    size: 4,
    at: 1,
    mediaKey: 'media-0',
    sha1: 'b'.repeat(40)
};

function stored(
    log: { revision: number; at: number; items: RemoteBmp[]; deleted: string[] }[],
    revision = 3
) {
    return {
        syncToken: 'c3luYy1vbmU',
        revision,
        items: [ITEM],
        log
    };
}

test('a persisted change log must increase and stay within the account revision', () => {
    const parsed = parseAccountState(
        stored([
            { revision: 1, at: 1, items: [ITEM], deleted: [] },
            { revision: 1, at: 2, items: [ITEM], deleted: [] }
        ])
    );

    expect(parsed?.items.size).toBe(1);
    expect(parsed?.log).toEqual([]);
});

test('a change above the account revision drops the log but keeps the account', () => {
    const parsed = parseAccountState(stored([{ revision: 4, at: 1, items: [ITEM], deleted: [] }]));

    expect(parsed?.revision).toBe(3);
    expect(parsed?.items.size).toBe(1);
    expect(parsed?.log).toEqual([]);
});

test('a gap in the change log drops the log but keeps the account', () => {
    const parsed = parseAccountState(
        stored(
            [
                { revision: 2, at: 1, items: [ITEM], deleted: [] },
                { revision: 4, at: 2, items: [ITEM], deleted: [] }
            ],
            4
        )
    );

    expect(parsed?.revision).toBe(4);
    expect(parsed?.items.size).toBe(1);
    expect(parsed?.log).toEqual([]);
});
