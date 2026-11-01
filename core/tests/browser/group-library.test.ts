import { afterEach, expect, test, vi } from 'vitest';
import {
    readGroupLibrary,
    readGroupLibraryUpdates
} from '@madkarmaa/phodrive-core/browser/library';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';

afterEach(() => vi.restoreAllMocks());

function remote(mediaKey: string, chunkIndex = 0): RemoteBmp {
    return {
        mediaKey,
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        sha1: 'c'.repeat(40),
        chunkIndex,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1
    };
}

function pageFor(email: string): Response {
    if (email === 'paused@example.com')
        return Response.json(
            { error: 'Google Photos is limiting requests', retryAfterSeconds: 30 },
            { status: 429 }
        );

    return Response.json({
        items:
            email === 'first@example.com'
                ? [remote('shared'), remote('first-only')]
                : [remote('shared')],
        nextPageToken: ''
    });
}

test('a missing group member is reported without a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const loaded = await readGroupLibrary([], ['missing@example.com']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loaded.unwrap().accounts).toContainEqual({
        email: 'missing@example.com',
        status: 'error',
        message: 'missing@example.com is not connected.'
    });
    expect(loaded.unwrap().partial).toBe(true);
});

test('a member with a future pause is not fetched', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async () =>
        Response.json({ items: [remote('first-only')], nextPageToken: '' })
    );
    const until = Date.now() + 30_000;

    const loaded = await readGroupLibrary([
        { email: 'first@example.com', token: 'aas_et/first' },
        { email: 'second@example.com', token: 'aas_et/second', pausedUntil: until }
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loaded.unwrap().accounts).toContainEqual(
        expect.objectContaining({ email: 'second@example.com', status: 'paused' })
    );
    expect(loaded.unwrap().partial).toBe(true);
});

test('a group listing tags owners, dedupes media keys, and names a paused member', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { email: string };

        return pageFor(body.email);
    });

    const loaded = await readGroupLibrary([
        { email: 'first@example.com', token: 'aas_et/first' },
        { email: 'second@example.com', token: 'aas_et/second' },
        { email: 'paused@example.com', token: 'aas_et/paused' }
    ]);

    const snapshot = loaded.unwrap();

    expect(snapshot.partial).toBe(true);
    expect(snapshot.accounts).toContainEqual(
        expect.objectContaining({
            email: 'paused@example.com',
            status: 'paused',
            retryAfterSeconds: 30
        })
    );
    expect(snapshot.chunks.filter((chunk) => chunk.mediaKey === 'shared')).toHaveLength(1);
    expect(snapshot.chunks.find((chunk) => chunk.mediaKey === 'shared')?.email).toBe(
        'first@example.com'
    );
    expect(snapshot.chunks.some((chunk) => chunk.email === 'paused@example.com')).toBe(false);
});

test('a group listing without failures is complete', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { email: string };

        return Response.json({ items: [remote(body.email)], nextPageToken: '' });
    });

    const loaded = await readGroupLibrary([
        { email: 'first@example.com', token: 'aas_et/first' },
        { email: 'second@example.com', token: 'aas_et/second' }
    ]);

    const snapshot = loaded.unwrap();

    expect(snapshot.partial).toBe(false);
    expect(snapshot.accounts.every((account) => account.status === 'ok')).toBe(true);
    expect(snapshot.chunks).toHaveLength(2);
});

test('a group refresh syncs each loaded member once and keeps items already loaded', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { email: string };

        return Response.json({
            items: [remote(`${body.email}-new`)],
            deleted: [],
            full: false,
            revision: 1
        });
    });
    const members = [
        { email: 'first@example.com', token: 'aas_et/first' },
        { email: 'second@example.com', token: 'aas_et/second' }
    ];
    const loaded = [
        { ...remote('first-old'), email: 'first@example.com' },
        { ...remote('second-old'), email: 'second@example.com' }
    ];

    const updated = await readGroupLibraryUpdates(
        members,
        [],
        loaded,
        members.map((member) => ({ email: member.email, status: 'ok' as const }))
    );
    const snapshot = updated.unwrap();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(snapshot.chunks.map((chunk) => chunk.mediaKey).toSorted()).toEqual([
        'first-old',
        'first@example.com-new',
        'second-old',
        'second@example.com-new'
    ]);
    expect(snapshot.accounts.every((account) => account.status === 'ok')).toBe(true);
    expect(snapshot.partial).toBe(false);
    expect(snapshot.revisions).toEqual({
        'first@example.com': 1,
        'second@example.com': 1
    });
});

test('a group refresh matches loaded items regardless of email case', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ items: [remote('fresh')], deleted: [], full: false, revision: 1 })
    );
    const loaded = [{ ...remote('kept'), email: 'owner@example.com' }];

    const updated = await readGroupLibraryUpdates(
        [{ email: 'Owner@Example.com', token: 'aas_et/owner' }],
        [],
        loaded,
        [{ email: 'Owner@Example.com', status: 'ok' }]
    );
    const snapshot = updated.unwrap();

    expect(snapshot.chunks.map((chunk) => chunk.mediaKey).toSorted()).toEqual(['fresh', 'kept']);
});

test('a failed group member keeps its loaded items and reports the pause', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { email: string };
        if (body.email === 'paused@example.com')
            return Response.json(
                { error: 'Google Photos is limiting requests', retryAfterSeconds: 30 },
                { status: 429 }
            );

        return Response.json({ items: [remote('fresh')], deleted: [], full: false, revision: 1 });
    });
    const members = [
        { email: 'first@example.com', token: 'aas_et/first' },
        { email: 'paused@example.com', token: 'aas_et/paused' }
    ];
    const loaded = [
        { ...remote('kept'), email: 'paused@example.com' },
        { ...remote('stale'), email: 'first@example.com' }
    ];

    const updated = await readGroupLibraryUpdates(
        members,
        [],
        loaded,
        members.map((member) => ({ email: member.email, status: 'ok' as const }))
    );
    const snapshot = updated.unwrap();

    expect(snapshot.partial).toBe(true);
    expect(snapshot.accounts).toContainEqual(
        expect.objectContaining({ email: 'paused@example.com', status: 'paused' })
    );
    expect(snapshot.chunks.map((chunk) => chunk.mediaKey).toSorted()).toEqual([
        'fresh',
        'kept',
        'stale'
    ]);
});

test('a member that recovers from a pause requests a forced full sync', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async () =>
        Response.json({
            items: [remote('page-zero'), remote('page-one')],
            deleted: [],
            full: true,
            revision: 1
        })
    );
    const loaded = [{ ...remote('kept'), email: 'owner@example.com' }];

    const updated = await readGroupLibraryUpdates(
        [{ email: 'owner@example.com', token: 'aas_et/owner' }],
        [],
        loaded,
        [{ email: 'owner@example.com', status: 'paused', retryAfterSeconds: 30 }]
    );
    const snapshot = updated.unwrap();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
        email: 'owner@example.com',
        force: true
    });
    expect(snapshot.partial).toBe(false);
    expect(snapshot.accounts).toContainEqual({
        email: 'owner@example.com',
        status: 'ok'
    });
    expect(snapshot.chunks.map((chunk) => chunk.mediaKey).toSorted()).toEqual([
        'page-one',
        'page-zero'
    ]);
});
