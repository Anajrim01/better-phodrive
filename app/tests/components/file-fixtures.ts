import { vi } from 'vitest';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';

export function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        folder: '',
        size: 4,
        at: 1,
        mediaKey: 'media-0',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

export function file(overrides: Partial<FileGroup> = {}): FileGroup {
    const id = overrides.fileId ?? 'a'.repeat(64);

    return {
        email: 'owner@example.com',
        fileHash: id,
        fileId: id,
        name: 'proof.bin',
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk({ fileId: id, fileHash: id })],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true,
        ...overrides
    };
}

export function selectionCallbacks() {
    return {
        onselect: vi.fn(),
        onselectall: vi.fn(),
        oncontextselect: vi.fn(),
        onselectionmenu: vi.fn(),
        ondownload: vi.fn(),
        ondelete: vi.fn(),
        onrestore: vi.fn(),
        ondeleteforever: vi.fn(),
        onmenu: vi.fn()
    };
}

export function domRect(left: number, top: number, right: number, bottom: number): DOMRect {
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        x: left,
        y: top,
        toJSON: () => ({})
    } as DOMRect;
}
