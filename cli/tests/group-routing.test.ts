import { PassThrough } from 'node:stream';
import { expect, test, vi } from 'vitest';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { deleteFile } from '@madkarmaa/phodrive-core/node';
import type { CliContext } from '../src/context';
import { saveGroupFiles } from '../src/downloads';
import { deleteGroupFiles } from '../src/library';

vi.mock('@madkarmaa/phodrive-core/node', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@madkarmaa/phodrive-core/node')>();

    return { ...actual, deleteFile: vi.fn() };
});

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

function file(): FileGroup {
    const chunk: UploadedChunk = {
        email: OWNER,
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
        email: OWNER,
        fileHash: chunk.fileHash,
        fileId: chunk.fileId,
        name: 'proof.bin',
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        trashedAt: null,
        complete: true
    };
}

function context(): CliContext {
    const output = new PassThrough();

    return {
        configPath: '',
        environment: {},
        cwd: '',
        stdin: new PassThrough(),
        stdout: output,
        stderr: output,
        interactive: false,
        signal: new AbortController().signal,
        release: null
    };
}

test('a known paused owner reports OWNER_PAUSED without a download', async () => {
    const routed = await saveGroupFiles(
        context(),
        [{ file: file(), destination: 'out.bin' }],
        [{ email: OWNER, token: 'aas_et/owner', paused: true }],
        false
    );

    expect(routed.unwrapErr()).toMatchObject({ code: 'OWNER_PAUSED' });
});

test('a file whose owner left the group reports OWNER_NOT_IN_GROUP', async () => {
    const routed = await saveGroupFiles(
        context(),
        [{ file: file(), destination: 'out.bin' }],
        [{ email: OTHER, token: 'aas_et/other', paused: false }],
        false
    );

    expect(routed.unwrapErr()).toMatchObject({ code: 'OWNER_NOT_IN_GROUP' });
});

test('a paused owner is not sent a delete request', async () => {
    const deleted = await deleteGroupFiles(
        context(),
        [file()],
        [{ email: OWNER, token: 'aas_et/owner', paused: true }],
        1
    );

    expect(deleted.isErr()).toBe(true);
    expect(vi.mocked(deleteFile)).not.toHaveBeenCalled();
});
