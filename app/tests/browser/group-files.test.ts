import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { deleteFile, downloadFile, saveDownloadedFile } from '#browser/files';
import { DriveFiles } from '#browser/drive/files.svelte';

vi.mock('#browser/files', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#browser/files')>();

    return {
        ...actual,
        downloadFile: vi.fn(),
        deleteFile: vi.fn(),
        saveDownloadedFile: vi.fn()
    };
});

const SELECTED = 'selected@example.com';
const OWNER = 'owner@example.com';
const PAUSED = 'paused@example.com';

function file(email: string): FileGroup {
    const chunk: UploadedChunk = {
        email,
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1,
        mediaKey: 'proof',
        sha1: 'b'.repeat(40)
    };

    return {
        email,
        fileHash: chunk.fileHash,
        fileId: chunk.fileId,
        name: 'proof.bin',
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk],
        duplicates: [],
        complete: true
    };
}

function driveFiles(feedback: string[]) {
    return new DriveFiles({
        account: () => ({ email: SELECTED, token: 'aas_et/selected' }),
        busy: () => false,
        loading: () => false,
        files: () => [],
        workers: () => 1,
        feedback: (message) => feedback.push(message),
        onDeleted: vi.fn(),
        closeUploads: vi.fn(),
        reload: vi.fn(),
        reloadGroup: vi.fn(),
        removeAccount: vi.fn(),
        groupMode: () => true,
        tokenForOwner: (email) => (email === OWNER ? 'aas_et/owner' : undefined),
        ownerPaused: (email) => email === PAUSED
    });
}

afterEach(() => vi.clearAllMocks());

test('a group download uses the owner token', async () => {
    vi.mocked(downloadFile).mockImplementation(() =>
        Ok(new Blob(['proof'])).andThenAsync(async () => Ok(new Blob(['proof'])))
    );
    vi.mocked(saveDownloadedFile).mockReturnValue(Ok(undefined));
    const feedback: string[] = [];
    const files = driveFiles(feedback);

    await files.act(file(OWNER), FileActionKind.Download);

    expect(downloadFile).toHaveBeenCalledWith(
        expect.objectContaining({ email: OWNER }),
        'aas_et/owner'
    );
    expect(feedback).not.toContain('The account for this file is not connected.');
});

test('a group delete uses the owner token', async () => {
    vi.mocked(deleteFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    const files = driveFiles([]);

    await files.act(file(OWNER), FileActionKind.Delete);

    expect(deleteFile).toHaveBeenCalledWith(
        expect.objectContaining({ email: OWNER }),
        'aas_et/owner',
        expect.any(Function),
        1
    );
});

test('a paused owner reports why the file is unavailable', async () => {
    const feedback: string[] = [];
    const files = driveFiles(feedback);

    await files.act(file(PAUSED), FileActionKind.Download);

    expect(downloadFile).not.toHaveBeenCalled();
    expect(feedback.at(-1)).toContain(`Files owned by ${PAUSED} are unavailable`);
});
