// @vitest-environment jsdom
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushSync } from 'svelte';
import { Ok } from 'results-ts';
import * as libraryApi from '@madkarmaa/phodrive-core/browser/library';
import type { DriveController } from '#browser/drive/index.svelte';
import { folderFromUrl } from '#browser/drive/folder-history';
import DriveHistoryHarness from '../components/drive-history-harness.svelte';

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@madkarmaa/phodrive-core/browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/browser/library', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@madkarmaa/phodrive-core/browser/library')>();

    return { ...actual, readLibraryPage: vi.fn() };
});

function remoteBmp(folder: string, index: number): RemoteBmp {
    const hash = index.toString(16).padStart(64, '0');

    return {
        mediaKey: `media-${index}`,
        fileHash: hash,
        fileId: hash,
        sha1: 'a'.repeat(40),
        chunkIndex: 0,
        isLast: true,
        originalName: `file-${index}.bin`,
        folder,
        size: 4,
        at: index
    };
}

function page(folders: string[]) {
    return Ok(undefined).andThenAsync(async () =>
        Ok({
            items: folders.map(remoteBmp),
            nextPageToken: '',
            revision: 1
        })
    );
}

async function settle(drive: DriveController): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        flushSync();
        if (!drive.library.loading && drive.library.files.length) return;
    }
}

beforeEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
    localStorage.setItem(
        'accounts',
        JSON.stringify({
            'test@example.com': 'aas_et/test',
            'other@example.com': 'aas_et/other'
        })
    );
    localStorage.setItem('selectedAccount', JSON.stringify('test@example.com'));
    vi.mocked(libraryApi.readLibraryPage).mockReset();
    vi.mocked(libraryApi.readLibraryPage).mockReturnValue(page(['A']));
});

afterEach(() => cleanup());

test('switching accounts returns to root and updates the URL', async () => {
    const ready: { drive?: DriveController } = {};
    render(DriveHistoryHarness, {
        props: {
            onready: (value) => {
                ready.drive = value;
            }
        }
    });
    const drive = ready.drive;
    if (!drive) throw new Error('Expected the drive controller');

    await settle(drive);
    drive.library.openFolder('A');
    flushSync();

    expect(drive.library.folder).toBe('A');
    expect(folderFromUrl(window.location.href)).toBe('A');

    drive.selectAccount('other@example.com');
    flushSync();
    await settle(drive);

    expect(drive.library.folder).toBe('');
    expect(new URL(window.location.href).searchParams.has('folder')).toBe(false);
});
