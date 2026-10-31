import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { resolveGroupTarget } from '#browser/drive/group-target';
import { readGroupLibrary } from '@madkarmaa/phodrive-core/browser/library';
import { DriveLibrary } from '#browser/drive/library.svelte';

vi.mock('@madkarmaa/phodrive-core/browser/library', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@madkarmaa/phodrive-core/browser/library')>();

    return { ...actual, readGroupLibrary: vi.fn() };
});

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';

function chunk(email: string, mediaKey: string): UploadedChunk {
    return {
        email,
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        mediaKey,
        sha1: 'c'.repeat(40),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1
    };
}

afterEach(() => vi.clearAllMocks());

test('a group target needs two connected members and carries pause state', () => {
    const group = {
        id: 'family',
        name: 'Family',
        accounts: [FIRST, SECOND, 'missing@example.com']
    };

    expect(
        resolveGroupTarget([group], 'family', { [FIRST]: 'aas_et/first' }, () => false)
    ).toBeNull();

    expect(
        resolveGroupTarget(
            [group],
            'family',
            { [FIRST]: 'aas_et/first', [SECOND]: 'aas_et/second' },
            (email) => email === SECOND
        )
    ).toEqual({
        group,
        members: [
            { email: FIRST, token: 'aas_et/first', paused: false },
            { email: SECOND, token: 'aas_et/second', paused: true }
        ]
    });
});

test('a group library merges owners, dedupes, and reports paused members', async () => {
    const accounts = [
        { email: FIRST, status: 'ok' as const },
        { email: SECOND, status: 'paused' as const, retryAfterSeconds: 30 }
    ];
    const onAccounts = vi.fn();
    vi.mocked(readGroupLibrary).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Ok({
                chunks: [chunk(FIRST, 'shared'), chunk(FIRST, 'second-copy')],
                accounts,
                partial: true
            })
        )
    );
    const library = new DriveLibrary(
        () => ({ email: FIRST, token: 'aas_et/first' }),
        () => false,
        () => FileSort.NameAscending,
        () => {},
        () => [
            { email: FIRST, token: 'aas_et/first' },
            { email: SECOND, token: 'aas_et/second' }
        ],
        onAccounts
    );

    await library.load();

    expect(readGroupLibrary).toHaveBeenCalledWith([
        { email: FIRST, token: 'aas_et/first' },
        { email: SECOND, token: 'aas_et/second' }
    ]);
    expect(library.partial).toBe(true);
    expect(library.accounts).toEqual(accounts);
    expect(onAccounts).toHaveBeenCalledWith(accounts);
    expect(library.chunks.map((item) => item.email)).toEqual([FIRST, FIRST]);
});
