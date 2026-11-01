import { render } from '@testing-library/svelte';
import { vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { Err, Ok } from 'results-ts';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import * as previewApi from '#browser/preview';
import FilePreviewDialog from '#components/FilePreviewDialog.svelte';

export function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'photo.png',
        folder: '',
        size: 4,
        at: 1,
        mediaKey: 'media-0',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

export function file(overrides: Partial<FileGroup> = {}): FileGroup {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'photo.png',
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

export function serve(payload: previewApi.PreviewPayload): void {
    vi.mocked(previewApi.fetchFilePreview).mockReturnValue(
        Ok(undefined).andThenAsync(async () => Ok(payload))
    );
}

export function fail(message: string): void {
    vi.mocked(previewApi.fetchFilePreview).mockReturnValue(
        Ok(undefined).andThenAsync(async () => Err({ code: 'REQUEST_FAILED', message } as const))
    );
}

export function mount(
    item: FileGroup,
    overrides: Partial<ComponentProps<typeof FilePreviewDialog>> = {}
) {
    const callbacks = {
        ondownload: vi.fn(),
        ondetails: vi.fn(),
        onclose: vi.fn()
    };
    const view = render(FilePreviewDialog, {
        props: {
            open: true,
            target: { kind: 'file', item },
            token: 'aas_et/test',
            ...callbacks,
            ...overrides
        }
    });

    return { ...callbacks, view };
}
