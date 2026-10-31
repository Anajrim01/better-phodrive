import { createHash } from 'node:crypto';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import {
    ConfirmKind,
    ThemeMode,
    UploadJobStatus,
    UploadStatus
} from '@madkarmaa/phodrive-core/models';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import { DriveController } from '#browser/drive/index.svelte';
import * as filesApi from '#browser/files';

const { storage } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => {
            values.delete(key);
        },
        setItem: (key, value) => {
            values.set(key, value);
        }
    };

    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    vi.stubGlobal('document', {
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@madkarmaa/phodrive-core/browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
    storage.setItem('accounts', JSON.stringify({ 'test@example.com': 'aas_et/fake-test-token' }));
});

afterAll(() => vi.unstubAllGlobals());

function chunk(
    mediaKey: string,
    at: number,
    compressed: boolean,
    fileId = createHash('sha256').update('proof.bin').digest('hex'),
    name = 'proof.bin'
): UploadedChunk {
    const bmp = Buffer.from(mediaKey);

    return {
        email: 'test@example.com',
        fileHash: fileId,
        fileId,
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        size: bmp.length,
        storedSize: bmp.length,
        compressed,
        at,
        mediaKey,
        sha1: createHash('sha1').update(bmp).digest('hex')
    };
}
test('a toggle and re-upload keeps the old chunk for onChunk delete', async () => {
    const old = chunk('raw-copy', 1, false);
    const fresh = chunk('compressed-copy', 2, true);
    const drive = new DriveController();
    drive.initialize();
    drive.library.chunks = [old];

    vi.spyOn(filesApi, 'uploadFiles').mockImplementation(
        (files, _email, _token, _workers, onJob, onChunk) => {
            const submitted = filesApi.createUploadJobs(files);

            return Ok(undefined).andThenAsync(async () => {
                onChunk(fresh);
                onJob({
                    ...submitted[0],
                    status: UploadJobStatus.Complete,
                    result: {
                        status: UploadStatus.Uploaded,
                        mediaKey: fresh.mediaKey,
                        sha1: fresh.sha1
                    }
                });

                return Ok(undefined);
            });
        }
    );

    await drive.upload([new File(['proof'], 'proof.bin')]);

    expect(drive.library.chunks).toHaveLength(2);
    const group = groupChunks(drive.library.chunks)[0];
    expect(group.chunks).toHaveLength(1);
    expect(group.duplicates).toHaveLength(1);

    let requested: UploadedChunk[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON');
        const body = JSON.parse(init.body) as { chunks: UploadedChunk[] };
        requested = body.chunks;

        return Response.json({ deleted: body.chunks });
    });

    drive.confirmTarget = { kind: ConfirmKind.File, item: group };
    drive.confirmOpen = true;
    drive.confirmAction();
    await vi.waitFor(() => expect(requested).toHaveLength(2));
    expect(requested.map((item) => item.mediaKey).sort()).toEqual(['compressed-copy', 'raw-copy']);

    expect(drive.library.chunks).toHaveLength(0);
});

test('same-name files with the same mediaKey both stay in the library', async () => {
    const first = chunk('same-name', 1, false, '1'.repeat(64));
    const second = chunk('same-name', 2, false, '2'.repeat(64));
    const drive = new DriveController();
    drive.initialize();

    vi.spyOn(filesApi, 'uploadFiles').mockImplementation(
        (files, _email, _token, _workers, onJob, onChunk) => {
            const submitted = filesApi.createUploadJobs(files);

            return Ok(undefined).andThenAsync(async () => {
                onChunk(first);
                onChunk(second);
                onJob({
                    ...submitted[0],
                    status: UploadJobStatus.Complete,
                    result: {
                        status: UploadStatus.Uploaded,
                        mediaKey: second.mediaKey,
                        sha1: second.sha1
                    }
                });

                return Ok(undefined);
            });
        }
    );

    await drive.upload([new File(['proof'], 'proof.bin')]);

    expect(drive.library.chunks).toHaveLength(2);
});
