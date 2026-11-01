// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileActionKind, FileSort } from '@madkarmaa/phodrive-core/models';
import type { FileAction, FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import FileList from '#components/FileList.svelte';

vi.hoisted(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
        })
    });
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        value: () => ({
            cancel: () => {},
            finish: () => {},
            finished: Promise.resolve(),
            addEventListener: () => {},
            removeEventListener: () => {}
        })
    });
});

beforeEach(() => cleanup());
afterEach(() => vi.restoreAllMocks());

function file(email: string, name: string): FileGroup {
    const chunk: UploadedChunk = {
        email,
        mediaKey: `${email}-chunk`,
        fileHash: 'a'.repeat(64),
        fileId: 'same-file-id',
        sha1: 'b'.repeat(40),
        chunkIndex: 0,
        chunkCount: 1,
        isLast: true,
        originalName: name,
        size: 1,
        at: 1
    };

    return {
        email,
        fileHash: chunk.fileHash,
        fileId: chunk.fileId,
        name,
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true
    };
}

test('only the owning file shows the action progress when file ids collide', () => {
    const action: FileAction = {
        email: 'first@example.com',
        fileId: 'same-file-id',
        kind: FileActionKind.Delete
    };
    const { container } = render(FileList, {
        props: {
            files: [
                file('first@example.com', 'first.bin'),
                file('second@example.com', 'second.bin')
            ],
            sort: FileSort.ModifiedDescending,
            disabled: false,
            action,
            onmenu: vi.fn(),
            ondownload: vi.fn(),
            ondelete: vi.fn(),
            onrestore: vi.fn(),
            ondeleteforever: vi.fn()
        }
    });

    const busy = [...container.querySelectorAll<HTMLButtonElement>('button[aria-busy="true"]')];
    expect(busy).toHaveLength(1);
    expect(busy[0]?.getAttribute('aria-label')).toBe('Delete first.bin');
});
