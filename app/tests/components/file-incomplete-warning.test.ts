// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import FileIncompleteWarning from '#components/FileIncompleteWarning.svelte';

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'test@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        sha1: 'b'.repeat(40),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1,
        mediaKey: 'media-0',
        ...overrides
    };
}

function file(overrides: Partial<FileGroup> = {}): FileGroup {
    return {
        email: 'test@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'proof.bin',
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk()],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true,
        ...overrides
    };
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('a complete file with a duplicate in Trash is not called incomplete', () => {
    render(FileIncompleteWarning, {
        props: {
            item: file({ trashedChunks: [chunk({ mediaKey: 'trash-0', trashedAt: 1 })] })
        }
    });

    expect(screen.getByText('1 duplicate chunk in Trash')).toBeTruthy();
    expect(screen.queryByText('This file cannot be downloaded.')).toBeNull();
});

test('a partially trashed file names its missing chunks', () => {
    render(FileIncompleteWarning, {
        props: {
            item: file({
                complete: false,
                chunkCount: 2,
                chunks: [chunk({ chunkIndex: 0, isLast: false })],
                trashedChunks: [chunk({ chunkIndex: 1, mediaKey: 'trash-1', trashedAt: 1 })]
            })
        }
    });

    expect(screen.getByText('1 of 2 chunks missing')).toBeTruthy();
    expect(screen.getByText('This file cannot be downloaded.')).toBeTruthy();
});
