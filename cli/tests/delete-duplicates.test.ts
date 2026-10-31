import { PassThrough } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { deleteFile } from '@madkarmaa/phodrive-core/node';
import type { CliContext } from '../src/context';
import { deleteFiles } from '../src/library';
import type { Session } from '../src/accounts';

vi.mock('@madkarmaa/phodrive-core/node', () => ({
    deleteFile: vi.fn(),
    readLibrary: vi.fn()
}));

const EMAIL = 'test@example.com';
const FILE_HASH = 'a'.repeat(64);

function remote(mediaKey: string, sha1: string, at: number, compressed: boolean): UploadedChunk {
    const chunk: RemoteBmp = {
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 1,
        storedSize: 1,
        compressed,
        at,
        mediaKey,
        sha1
    };

    return { ...chunk, email: EMAIL };
}

afterEach(() => vi.restoreAllMocks());

test('cli delete sends both stored copies of the same file', async () => {
    let requested: UploadedChunk[] = [];
    vi.mocked(deleteFile).mockImplementation((item) => {
        requested = item.chunks;

        return Ok({ deleted: item.chunks }).andThenAsync(async () => Ok({ deleted: item.chunks }));
    });

    const chunks = remote('raw-copy', 'a'.repeat(40), 1, false);
    const duplicates = remote('compressed-copy', 'b'.repeat(40), 2, true);
    const file: FileGroup = {
        email: EMAIL,
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        name: 'proof.bin',
        folder: '',
        at: 2,
        chunkCount: 1,
        chunks: [chunks],
        duplicates: [duplicates],
        complete: true
    };
    const output = new PassThrough();
    const context: CliContext = {
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
    const session: Session = {
        email: EMAIL,
        token: 'aas_et/test',
        config: { accounts: {}, selected: '', settings: {}, albums: {} }
    };

    const result = await deleteFiles(context, session, [file], 1);

    expect(result.isOk()).toBe(true);
    expect(requested).toHaveLength(2);
});
