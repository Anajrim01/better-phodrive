import { expect, test } from 'vitest';
import { Ok, type AsyncResult, type Result } from 'results-ts';
import type { LibraryWarning, RemoteBmp } from '@madkarmaa/phodrive-core/models';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import {
    fileSnapshot,
    folderSnapshot,
    readAccountSnapshot
} from '@madkarmaa/phodrive-core/server/photos/shares';
import type { listBmps } from '@madkarmaa/phodrive-core/server/photos/library';

const HASH = 'a'.repeat(64);
const SHA1 = 'b'.repeat(40);

type ChunkOptions = {
    fileId: string;
    chunkIndex: number;
    isLast: boolean;
    name?: string;
    folder?: string;
    trashed?: boolean;
    mediaKey: string;
};

function chunk(options: ChunkOptions): RemoteBmp {
    return {
        fileHash: HASH,
        fileId: options.fileId,
        chunkIndex: options.chunkIndex,
        isLast: options.isLast,
        ...(options.chunkIndex === 0 ? { originalName: options.name ?? 'file.bin' } : {}),
        ...(options.chunkIndex === 0 && options.folder ? { folder: options.folder } : {}),
        size: 10,
        at: 1,
        mediaKey: options.mediaKey,
        sha1: SHA1,
        ...(options.trashed ? { trashed: true } : {})
    };
}

type Page = { items: RemoteBmp[]; nextPageToken: string; warnings: LibraryWarning[] };

function page(
    items: RemoteBmp[],
    nextPageToken = '',
    warnings: LibraryWarning[] = []
): AsyncResult<Page, ServerError> {
    return Ok({ items, nextPageToken, warnings }).andThenAsync<Page, ServerError>(async (current) =>
        Ok(current)
    );
}

function account() {
    return { email: 'a@example.com', token: 'aas_et/a' };
}

function completeFile(fileId: string, folder: string, chunks = 2): RemoteBmp[] {
    return Array.from({ length: chunks }, (_, index) =>
        chunk({
            fileId,
            chunkIndex: index,
            isLast: index === chunks - 1,
            name: `file-${fileId}.bin`,
            folder,
            mediaKey: `${fileId}-${index}`
        })
    );
}

test('reads every page and preserves relative folder paths', async () => {
    const pages = [
        page(
            [
                ...completeFile('1'.repeat(64), 'Projects/2026'),
                ...completeFile('2'.repeat(64), 'Projects/2026/src')
            ],
            'next'
        ),
        page([...completeFile('3'.repeat(64), 'Elsewhere')])
    ];
    let calls = 0;
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() => pages[calls++]!) as unknown as typeof listBmps
    });

    const files = folderSnapshot(snapshot.unwrap(), 'Projects/2026').unwrap();
    expect(files.map((file) => file.file.fileId).sort()).toEqual(['1'.repeat(64), '2'.repeat(64)]);
    expect(files.map((file) => file.file.folder).sort()).toEqual([
        'Projects/2026',
        'Projects/2026/src'
    ]);
});

test('fails a folder when one matching file is incomplete', async () => {
    const incomplete = completeFile('1'.repeat(64), 'Projects/2026').slice(0, 1);
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() =>
            page([
                ...incomplete,
                ...completeFile('2'.repeat(64), 'Projects/2026')
            ])) as unknown as typeof listBmps
    });

    const result = folderSnapshot(snapshot.unwrap(), 'Projects/2026');
    expect(result.unwrapErr().code).toBe('SHARE_SNAPSHOT_INCOMPLETE');
});

test('fails a folder when a matching file is partly in Trash', async () => {
    const chunks = completeFile('1'.repeat(64), 'Projects/2026');
    chunks[1] = { ...chunks[1]!, trashed: true };
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() => page(chunks)) as unknown as typeof listBmps
    });

    const result = folderSnapshot(snapshot.unwrap(), 'Projects/2026');
    expect(result.unwrapErr().code).toBe('SHARE_SNAPSHOT_INCOMPLETE');
});

function trashedFile(fileId: string, folder: string) {
    return completeFile(fileId, folder).map((current) => ({ ...current, trashed: true }));
}

test('a folder leaves out a fully trashed child and shares its active files', async () => {
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() =>
            page([
                ...trashedFile('1'.repeat(64), 'Projects/2026'),
                ...completeFile('2'.repeat(64), 'Projects/2026')
            ])) as unknown as typeof listBmps
    });

    const files = folderSnapshot(snapshot.unwrap(), 'Projects/2026').unwrap();
    expect(files.map((current) => current.file.fileId)).toEqual(['2'.repeat(64)]);
});

test('a folder holding only fully trashed files has no active files to share', async () => {
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() =>
            page(trashedFile('1'.repeat(64), 'Projects/2026'))) as unknown as typeof listBmps
    });

    expect(folderSnapshot(snapshot.unwrap(), 'Projects/2026').unwrapErr().code).toBe(
        'SHARE_INVALID'
    );
});

test('a fully trashed child does not hide a broken active file', async () => {
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() =>
            page([
                ...trashedFile('1'.repeat(64), 'Projects/2026'),
                ...completeFile('2'.repeat(64), 'Projects/2026').slice(0, 1)
            ])) as unknown as typeof listBmps
    });

    expect(folderSnapshot(snapshot.unwrap(), 'Projects/2026').unwrapErr().code).toBe(
        'SHARE_SNAPSHOT_INCOMPLETE'
    );
});

test('a direct share of a fully trashed file still fails', async () => {
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() =>
            page(trashedFile('1'.repeat(64), 'Projects/2026'))) as unknown as typeof listBmps
    });

    expect(fileSnapshot(snapshot.unwrap(), '1'.repeat(64)).unwrapErr().code).toBe(
        'SHARE_SNAPSHOT_INCOMPLETE'
    );
});

test('fails a snapshot when a provider entry could not be parsed', async () => {
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() =>
            page(completeFile('1'.repeat(64), 'Projects/2026'), '', [
                { code: 'ENTRY_PARSE_FAILED', count: 1 }
            ])) as unknown as typeof listBmps
    });

    expect(snapshot.unwrapErr().code).toBe('SHARE_SNAPSHOT_INCOMPLETE');
});

test('rejects chunks whose identity fields disagree with the file group', async () => {
    const chunks = completeFile('1'.repeat(64), 'Projects/2026');
    chunks[1] = { ...chunks[1]!, fileHash: 'c'.repeat(64) };
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() => page(chunks)) as unknown as typeof listBmps
    });

    expect(fileSnapshot(snapshot.unwrap(), '1'.repeat(64)).unwrapErr().code).toBe(
        'SHARE_SNAPSHOT_INCOMPLETE'
    );
});

test('file snapshots reject incomplete and partly trashed files', async () => {
    const incomplete = completeFile('1'.repeat(64), 'Projects/2026').slice(0, 1);
    const snapshot = await readAccountSnapshot(account(), {
        listPage: (() => page(incomplete)) as unknown as typeof listBmps
    });

    expect(fileSnapshot(snapshot.unwrap(), '1'.repeat(64)).unwrapErr().code).toBe(
        'SHARE_SNAPSHOT_INCOMPLETE'
    );
    expect(fileSnapshot(snapshot.unwrap(), '9'.repeat(64)).unwrapErr().code).toBe(
        'SHARE_FILE_NOT_FOUND'
    );
});
