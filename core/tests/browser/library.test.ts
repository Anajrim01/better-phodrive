import { afterEach, expect, test, vi } from 'vitest';
import {
    applyLibraryDelta,
    readLibrarySnapshot,
    readLibrarySync
} from '@madkarmaa/phodrive-core/browser/library';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';

afterEach(() => vi.restoreAllMocks());

function remoteFile(mediaKey: string): RemoteBmp {
    return {
        mediaKey,
        fileHash: '0'.repeat(64),
        fileId: '0'.repeat(64),
        sha1: '0'.repeat(40),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1
    };
}

test('refresh reads the loaded pagination depth and stops when the library ends', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({
            items: [remoteFile('new-upload')],
            nextPageToken: 'page-two',
            revision: 1
        })
    );
    fetchMock.mockResolvedValueOnce(
        Response.json({ items: [remoteFile('existing-file')], nextPageToken: '', revision: 1 })
    );

    const refreshed = await readLibrarySnapshot('test@example.com', 'aas_et/test', 3);

    expect(refreshed.unwrap().items.map((item) => item.mediaKey)).toEqual([
        'new-upload',
        'existing-file'
    ]);
    expect(refreshed.unwrap().pages).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
        JSON.stringify({ email: 'test@example.com', token: 'aas_et/test', pageToken: 'page-two' })
    );
});

test('a multi-page snapshot keeps the first page revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({
            items: [remoteFile('first')],
            nextPageToken: 'page-two',
            revision: 10
        })
    );
    fetchMock.mockResolvedValueOnce(
        Response.json({ items: [remoteFile('second')], nextPageToken: '', revision: 11 })
    );

    const refreshed = await readLibrarySnapshot('test@example.com', 'aas_et/test', 2);

    expect(refreshed.unwrap().items.map((item) => item.mediaKey)).toEqual(['first', 'second']);
    expect(refreshed.unwrap().revision).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a library sync posts the force flag and parses the delta', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({
            items: [{ ...remoteFile('changed'), originalName: 'renamed.bin' }],
            deleted: ['removed'],
            full: false,
            revision: 2
        })
    );

    const synced = await readLibrarySync('test@example.com', 'aas_et/test', true);
    const snapshot = synced.unwrap();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/library/sync');
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
        JSON.stringify({
            email: 'test@example.com',
            token: 'aas_et/test',
            force: true,
            revision: 0
        })
    );
    expect(snapshot.items.map((item) => item.mediaKey)).toEqual(['changed']);
    expect(snapshot.items[0]?.originalName).toBe('renamed.bin');
    expect(snapshot.deleted).toEqual(['removed']);
    expect(snapshot.full).toBe(false);
    expect(snapshot.revision).toBe(2);
});

test('a library delta replaces changed items, removes deletions, and keeps the rest', () => {
    const current = [
        { ...remoteFile('changed'), email: 'test@example.com' },
        { ...remoteFile('removed'), email: 'test@example.com' },
        { ...remoteFile('existing-file'), email: 'test@example.com' }
    ];
    const items = applyLibraryDelta(current, 'test@example.com', {
        items: [
            { ...remoteFile('changed'), originalName: 'renamed.bin' },
            remoteFile('new-upload')
        ],
        deleted: ['removed']
    });

    expect(items.map((item) => item.mediaKey)).toEqual(['changed', 'existing-file', 'new-upload']);
    expect(items[0]?.originalName).toBe('renamed.bin');
    expect(items.every((item) => item.email === 'test@example.com')).toBe(true);
});

test('a failed later page rejects the refresh instead of returning a partial replacement', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({
            items: [remoteFile('new-upload')],
            nextPageToken: 'page-two',
            revision: 1
        })
    );
    fetchMock.mockResolvedValueOnce(
        Response.json({ error: 'Library unavailable' }, { status: 503 })
    );

    const refreshed = await readLibrarySnapshot('test@example.com', 'aas_et/test', 2);

    expect(refreshed.unwrapErr().message).toBe('Library unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
