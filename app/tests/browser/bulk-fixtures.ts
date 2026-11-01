import { vi } from 'vitest';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { ManageResponse } from '@madkarmaa/phodrive-core/manage';
import { DriveBulk } from '#browser/drive/bulk.svelte';
import { DriveSelection } from '#browser/drive/selection.svelte';

export function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'first@example.com',
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
        email: 'first@example.com',
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

export function ok<T>(value: T): AsyncResult<T, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => Ok(value));
}

export function failed<T = void>(message: string): AsyncResult<T, ApplicationError> {
    return Ok(undefined).andThenAsync(async () =>
        Err({ code: 'REQUEST_FAILED', message } as const)
    );
}

export function manageResponse(): ManageResponse {
    return { items: [], revision: 3 };
}

export type Deps = ConstructorParameters<typeof DriveBulk>[0];

export function makeBulk(overrides: Partial<Deps> = {}) {
    const selection = new DriveSelection();
    const feedback = vi.fn();
    const applyItems = vi.fn();
    const reload = vi.fn();
    const reloadGroup = vi.fn();
    const closeUploads = vi.fn();
    let allFiles: FileGroup[] = [];
    const deps: Deps = {
        selection,
        account: () => ({ email: 'first@example.com', token: 'token-first' }),
        groupMode: () => false,
        routeMembers: () => [],
        workers: () => 2,
        onTrashed: vi.fn(),
        onRestored: vi.fn(),
        onRemoved: vi.fn(),
        allFiles: () => allFiles,
        currentFiles: () => allFiles,
        busy: () => false,
        loading: () => false,
        applyItems,
        reload,
        reloadGroup,
        closeUploads,
        feedback,
        ...overrides
    };

    return {
        bulk: new DriveBulk(deps),
        selection,
        feedback,
        applyItems,
        reload,
        reloadGroup,
        closeUploads,
        setFiles(next: FileGroup[]) {
            allFiles = next;
        }
    };
}

export const ownerRoute = (email: string) => ({
    email,
    token: `token-${email}`,
    paused: false
});
