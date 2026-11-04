import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import {
    downloadFile,
    deleteFile,
    deleteForeverFile,
    restoreFile
} from '@madkarmaa/phodrive-core/server/files';
import {
    createThrottleCoordinator,
    downloadBmp,
    mutatePhotos
} from '@madkarmaa/phodrive-core/server/photos';
import { FileActionKind, type RemoteBmp } from '@madkarmaa/phodrive-core/models';
import type { ChunkMetadataStore } from '@madkarmaa/phodrive-core/server/photos';
import { bmpResponse, downloadFixture } from '../helpers/download';
import { asyncOk, serveBmps } from '../helpers/photos-mock';

vi.mock('@madkarmaa/phodrive-core/server/photos', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@madkarmaa/phodrive-core/server/photos')>();

    return {
        ...actual,
        downloadBmp: vi.fn(),
        mutatePhotos: vi.fn()
    };
});

const scope = { key: 'account-a', coordinator: createThrottleCoordinator() };

beforeEach(() => {
    vi.mocked(mutatePhotos).mockImplementation((_kind, _account, targets) =>
        asyncOk({ applied: [...targets] })
    );
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function fixture() {
    const data = downloadFixture();
    serveBmps(data.bmps);

    return data;
}

test('server streams ordered raw bytes without allocating temporary storage', async () => {
    const { input, original } = fixture();
    const result = await downloadFile({ ...input, chunks: input.chunks.toReversed() });
    const response = result.unwrap();
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.has('content-length')).toBe(false);
    expect(downloadBmp).toHaveBeenCalledTimes(1);

    const bytes = await response.arrayBuffer();
    expect(Buffer.from(bytes)).toEqual(Buffer.from(original));
    expect(downloadBmp).toHaveBeenCalledTimes(2);
});

test.each([1, 2, 7, 129, 65_536])(
    'headers and payloads split across %i-byte network blocks restore Unicode filenames',
    async (blockSize) => {
        const original = Buffer.from([0, 255, 13, 10, 42]);
        const { input, bmps } = downloadFixture(original, '写真 🎉.bin');
        serveBmps(bmps, blockSize);
        const downloaded = await downloadFile(input);
        const bytes = await downloaded.unwrap().arrayBuffer();
        expect(Buffer.from(bytes)).toEqual(original);
    }
);

test('a zero-byte last chunk still verifies its BMP and the complete file hash', async () => {
    const original = Buffer.from([0, 255, 42]);
    const { input, bmps } = downloadFixture(original, 'trailing-empty.bin', [
        original,
        new Uint8Array()
    ]);
    serveBmps(bmps, 256);
    const downloaded = await downloadFile(input);
    const bytes = await downloaded.unwrap().arrayBuffer();
    expect(Buffer.from(bytes)).toEqual(original);
    expect(downloadBmp).toHaveBeenCalledTimes(2);
});

test('oversized requested headers are rejected by the reader and their body is cancelled', async () => {
    const { input, bmps } = fixture();
    const name = 'a'.repeat(65_536);
    const cancelled = vi.fn();
    vi.mocked(downloadBmp).mockImplementation(() =>
        asyncOk(bmpResponse(bmps[0], 1024, { onCancel: cancelled }))
    );
    const downloaded = await downloadFile({
        ...input,
        name,
        chunks: input.chunks.map((chunk) =>
            chunk.chunkIndex === 0 ? { ...chunk, originalName: name } : chunk
        )
    });
    expect(downloaded.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_CHUNK_METADATA);
    expect(downloadBmp).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
});

test('incomplete and empty groups fail before contacting Photos; incorrect first metadata cancels its body', async () => {
    const { input, bmps } = fixture();
    for (const chunks of [[], input.chunks.slice(0, 1)]) {
        const incomplete = await downloadFile({ ...input, chunks });
        expect(incomplete.unwrapErr()).toEqual(SERVER_ERRORS.INCOMPLETE_DOWNLOAD_CHUNKS);
    }
    expect(downloadBmp).not.toHaveBeenCalled();

    const cancelled = vi.fn();
    vi.mocked(downloadBmp).mockImplementation(() =>
        asyncOk(bmpResponse(bmps[0], 1024, { onCancel: cancelled }))
    );
    const wrongSize = await downloadFile({
        ...input,
        chunks: input.chunks.map((chunk) => ({ ...chunk, size: 99 }))
    });
    expect(wrongSize.unwrapErr()).toEqual(SERVER_ERRORS.DOWNLOAD_CHUNK_MISMATCH);
    expect(cancelled).toHaveBeenCalledOnce();
});

test('server deletion returns confirmed chunks and preserves a partial failure', async () => {
    const { input } = fixture();
    const chunks: RemoteBmp[] = Array.from({ length: 5 }, (_, index) => ({
        ...input.chunks[index % 2],
        chunkIndex: index,
        mediaKey: `chunk-${index}`
    }));
    vi.mocked(mutatePhotos).mockImplementation((_kind, _account, targets) =>
        asyncOk({
            applied: targets.slice(0, 2),
            failure: { code: 'REQUEST_FAILED', message: 'Delete failed' } as const
        })
    );

    const result = await deleteFile({ ...input, action: FileActionKind.Delete, chunks }, scope);

    expect(result.unwrap().applied).toHaveLength(2);
    expect(result.unwrap().error).toBe('Delete failed');
    expect(mutatePhotos).toHaveBeenCalledWith(
        'trash',
        { email: input.email, token: input.token },
        chunks,
        scope,
        expect.any(Function),
        undefined
    );
});

test('restore requires trashed chunks and returns confirmed progress', async () => {
    const { input } = fixture();
    const chunks = input.chunks.map((chunk) => ({ ...chunk, trashed: true }));
    const result = await restoreFile({ ...input, action: FileActionKind.Restore, chunks }, scope);

    expect(result.unwrap().applied).toHaveLength(chunks.length);
    expect(mutatePhotos).toHaveBeenCalledWith(
        'restore',
        { email: input.email, token: input.token },
        chunks,
        scope,
        expect.any(Function),
        undefined
    );

    const active = await restoreFile(
        { ...input, action: FileActionKind.Restore, chunks: input.chunks },
        scope
    );
    expect(active.unwrapErr()).toEqual(SERVER_ERRORS.NOT_TRASHED);
});

test('permanent delete removes metadata only after confirmed progress', async () => {
    const { input } = fixture();
    const chunks = input.chunks.map((chunk) => ({ ...chunk, trashed: true }));
    const removed: string[][] = [];
    const metadata: ChunkMetadataStore = {
        load: vi.fn(),
        save: vi.fn(),
        remove: async (mediaKeys) => {
            removed.push([...mediaKeys]);
        }
    };
    vi.mocked(mutatePhotos).mockImplementation((_kind, _account, targets) =>
        asyncOk({
            applied: [...targets],
            failure: { code: 'REQUEST_FAILED', message: 'Late failure' } as const
        })
    );

    const failed = await deleteForeverFile(
        { ...input, action: FileActionKind.DeleteForever, chunks },
        scope,
        metadata
    );
    expect(failed.unwrap().applied).toHaveLength(chunks.length);
    expect(failed.unwrap().error).toBe('Late failure');
    const onApplied = vi.mocked(mutatePhotos).mock.calls[0]?.[5];
    await onApplied?.(chunks);
    expect(removed).toEqual([chunks.map((chunk) => chunk.mediaKey)]);

    removed.length = 0;
    vi.mocked(mutatePhotos).mockImplementation(() =>
        asyncOk({ applied: [], failure: { code: 'REQUEST_FAILED', message: 'Failed' } as const })
    );
    const rejected = await deleteForeverFile(
        { ...input, action: FileActionKind.DeleteForever, chunks },
        scope,
        metadata
    );
    expect(rejected.unwrap().applied).toHaveLength(0);
    expect(removed).toEqual([]);
});

test('download rejects a file with a trashed chunk', async () => {
    const { input } = fixture();
    const trashed = {
        ...input,
        chunks: input.chunks.map((chunk, index) =>
            index === 0 ? { ...chunk, trashed: true } : chunk
        )
    };
    const result = await downloadFile(trashed);
    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.INCOMPLETE_DOWNLOAD_CHUNKS);
});
