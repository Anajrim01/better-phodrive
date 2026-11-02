import { FileSort, type RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { Ok } from 'results-ts';
import { vi } from 'vitest';
import * as libraryApi from '@madkarmaa/phodrive-core/browser/library';
import { DriveLibrary } from '#browser/drive/library.svelte';

export function remoteBmp(folder: string, index: number): RemoteBmp {
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

export function page(folders: string[], nextPageToken = '', offset = 0) {
    return Ok(undefined).andThenAsync(async () =>
        Ok({
            items: folders.map((folder, index) => remoteBmp(folder, index + offset)),
            nextPageToken,
            revision: 1
        })
    );
}

export function makeLibrary(folders: string[]): DriveLibrary {
    vi.mocked(libraryApi.readLibraryPage).mockReturnValue(page(folders));

    return new DriveLibrary(
        () => ({ email: 'test@example.com', token: 'aas_et/test' }),
        () => false,
        () => FileSort.NameAscending,
        () => {}
    );
}

export function makeGroupLibrary(): DriveLibrary {
    return new DriveLibrary(
        () => ({ email: 'test@example.com', token: 'aas_et/test' }),
        () => false,
        () => FileSort.NameAscending,
        () => {},
        () => ({
            members: [{ email: 'test@example.com', token: 'aas_et/test' }],
            missing: []
        })
    );
}

export function resetLibraryMocks(): void {
    vi.mocked(libraryApi.readLibraryPage).mockReset();
    vi.mocked(libraryApi.readLibrarySnapshot).mockReset();
    vi.mocked(libraryApi.readLibrarySync).mockReset();
    vi.mocked(libraryApi.readGroupLibrary).mockReset();
    vi.mocked(libraryApi.readGroupLibraryUpdates).mockReset();
}

export function waitForPopState(): Promise<void> {
    return new Promise((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
    });
}

export async function traverse(direction: 'back' | 'forward'): Promise<void> {
    const moved = waitForPopState();
    if (direction === 'back') window.history.back();
    else window.history.forward();

    await moved;
}

export function currentFolder(): string {
    return new URL(window.location.href).searchParams.get('folder') ?? '';
}
