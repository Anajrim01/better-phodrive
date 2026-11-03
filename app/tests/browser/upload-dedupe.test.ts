import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import {
    UploadEventType,
    UploadJobStatus,
    UploadRequestSchema,
    UploadStatus
} from '@madkarmaa/phodrive-core/models';
import { groupChunks, type FileGroup, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { GroupUploadMember } from '@madkarmaa/phodrive-core/browser/upload';
import type { BrowserPreferences } from '#browser/storage';
import { DriveUploads, type UploadDeps } from '#browser/drive/uploads.svelte';
import { pruneRecent, uploadKey } from '#browser/drive/upload-dedupe';
import { browserUploadResponse } from '../../../core/tests/helpers/upload';

const EMAIL = 'first@example.com';
const SECOND = 'second@example.com';
const PAYLOAD = Uint8Array.of(0, 255, 13, 10, 42);
const SHA1 = 'a'.repeat(40);

afterEach(() => vi.restoreAllMocks());

function existingFile(name: string, email = EMAIL, folder = '', compressed = false): FileGroup {
    const fileHash = createHash('sha256').update(PAYLOAD).digest('hex');
    const chunk: UploadedChunk = {
        email,
        fileHash,
        fileId: fileHash,
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        folder: folder || undefined,
        size: PAYLOAD.length,
        at: 1,
        mediaKey: `${name}-key`,
        sha1: SHA1,
        compressed: compressed || undefined
    };

    return groupChunks([chunk])[0]!;
}

function driveUploads(
    options: {
        files?: readonly FileGroup[] | (() => readonly FileGroup[]);
        folder?: string;
        compression?: boolean;
        group?: GroupUploadMember[] | null;
        onChunk?: (chunk: UploadedChunk) => void;
    } = {}
): DriveUploads {
    const deps: UploadDeps = {
        account: () => ({ email: EMAIL, token: 'aas_et/first' }),
        group: () => (options.group ? { members: options.group } : null),
        folder: () => options.folder ?? '',
        files: () =>
            typeof options.files === 'function' ? options.files() : (options.files ?? []),
        workers: () => 1,
        loading: () => false,
        blocked: () => false,
        preferences: () =>
            options.compression === undefined
                ? null
                : ({ compression: options.compression } as BrowserPreferences),
        feedback: () => {},
        onChunk: options.onChunk ?? (() => {}),
        afterUpload: () => {},
        reload: () => {},
        markPaused: () => {},
        observe: () => {}
    };

    return new DriveUploads(deps);
}

function mockUpload() {
    return vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_url, init) => browserUploadResponse(init));
}

test('a duplicate against the loaded library skips the transport', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const uploads = driveUploads({ files: [existingFile('proof.bin')] });

    await uploads.upload([new File([PAYLOAD], 'proof.bin')]);

    expect(fetch).not.toHaveBeenCalled();
    expect(uploads.jobs[0]).toMatchObject({
        status: UploadJobStatus.Complete,
        result: {
            status: UploadStatus.AlreadyExists,
            mediaKey: 'proof.bin-key',
            sha1: SHA1
        }
    });
});

test('same name and content in another folder is skipped', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const uploads = driveUploads({
        files: [existingFile('proof.bin', EMAIL, 'other')],
        folder: 'current'
    });

    await uploads.upload([new File([PAYLOAD], 'proof.bin')]);

    expect(fetch).not.toHaveBeenCalled();
    expect(uploads.jobs[0]?.result?.status).toBe(UploadStatus.AlreadyExists);
});

test('identical content under a different name still uploads', async () => {
    const fetch = mockUpload();
    const uploads = driveUploads({ files: [existingFile('proof.bin')] });

    await uploads.upload([new File([PAYLOAD], 'other.bin')]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(uploads.jobs[0]?.result?.status).toBe(UploadStatus.Uploaded);
});

test.each([
    { libraryCompressed: true, uploadCompressed: false },
    { libraryCompressed: false, uploadCompressed: true }
])(
    'compression state does not enter the dedupe key: library $libraryCompressed, upload $uploadCompressed',
    async ({ libraryCompressed, uploadCompressed }) => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        const uploads = driveUploads({
            files: [existingFile('proof.bin', EMAIL, '', libraryCompressed)],
            compression: uploadCompressed
        });

        await uploads.upload([new File([PAYLOAD], 'proof.bin')]);

        expect(fetch).not.toHaveBeenCalled();
        expect(uploads.jobs[0]?.result?.status).toBe(UploadStatus.AlreadyExists);
    }
);

test('same-selection duplicates produce one network upload', async () => {
    const fetch = mockUpload();
    const chunks: UploadedChunk[] = [];
    const uploads = driveUploads({ onChunk: (chunk) => chunks.push(chunk) });

    await uploads.upload([
        new File([PAYLOAD], 'proof.bin', { lastModified: 1 }),
        new File([PAYLOAD], 'proof.bin', { lastModified: 1 })
    ]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(chunks).toHaveLength(1);
    expect(uploads.jobs[0]?.result?.status).toBe(UploadStatus.Uploaded);
    expect(uploads.jobs[1]?.result?.status).toBe(UploadStatus.AlreadyExists);
    expect(uploads.jobs[1]?.result?.mediaKey).toBe(uploads.jobs[0]?.result?.mediaKey);
});

test('duplicate jobs keep their own rows when another file follows them', async () => {
    mockUpload();
    const uploads = driveUploads();

    await uploads.upload([
        new File([PAYLOAD], 'proof.bin', { lastModified: 1 }),
        new File([PAYLOAD], 'proof.bin', { lastModified: 1 }),
        new File(['other bytes'], 'other.bin')
    ]);

    expect(uploads.jobs[0]?.result?.status).toBe(UploadStatus.Uploaded);
    expect(uploads.jobs[1]?.result?.status).toBe(UploadStatus.AlreadyExists);
    expect(uploads.jobs[2]).toMatchObject({
        name: 'other.bin',
        status: UploadJobStatus.Complete,
        result: { status: UploadStatus.Uploaded }
    });
});

test('a recent entry only survives while its exact uploaded copy exists', () => {
    const file = existingFile('proof.bin');
    const recent = new Map([
        [uploadKey(EMAIL, file.name, file.fileHash), { mediaKey: 'deleted-key', sha1: SHA1 }]
    ]);

    pruneRecent(recent, [file], new Set());
    expect(recent.size).toBe(0);

    recent.set(uploadKey(EMAIL, file.name, file.fileHash), {
        mediaKey: file.chunks[0]!.mediaKey,
        sha1: SHA1
    });
    pruneRecent(recent, [file], new Set());
    expect(recent.size).toBe(1);

    pruneRecent(recent, [{ ...file, complete: false }], new Set());
    expect(recent.size).toBe(0);

    pruneRecent(recent, [file], new Set([`${EMAIL.toLowerCase()}\u0000${file.fileId}`]));
    expect(recent.size).toBe(0);
});

test('a deleted in-session upload is not reused', async () => {
    const fetch = mockUpload();
    const uploads = driveUploads();

    await uploads.upload([new File([PAYLOAD], 'proof.bin', { lastModified: 1 })]);
    uploads.syncRecent([]);
    await uploads.upload([new File([PAYLOAD], 'proof.bin', { lastModified: 2 })]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(uploads.jobs[0]?.result?.status).toBe(UploadStatus.Uploaded);
});

test('a failed sibling with identical bytes still retries', async () => {
    const chunks: UploadedChunk[] = [];
    let attempts = 0;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (!(init?.body instanceof FormData)) throw new Error('Expected upload form');
        const json = init.body.get('metadata');
        if (typeof json !== 'string') throw new Error('Missing upload metadata');
        const request = UploadRequestSchema.parse(JSON.parse(json));

        if (request.file.name === 'first.bin') return browserUploadResponse(init);
        attempts++;

        return browserUploadResponse(init, attempts > 1, (events) =>
            attempts === 1
                ? events.filter(
                      (event) =>
                          event.type !== UploadEventType.FileComplete &&
                          event.type !== UploadEventType.Complete
                  )
                : events
        );
    });
    const uploads = driveUploads({
        files: () => groupChunks(chunks),
        onChunk: (chunk) => chunks.push(chunk)
    });

    await uploads.upload([
        new File(['same bytes'], 'first.bin'),
        new File(['same bytes'], 'second.bin')
    ]);
    expect(uploads.jobs[1]?.status).toBe(UploadJobStatus.Error);

    await uploads.retry(1);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(uploads.jobs[1]?.status).toBe(UploadJobStatus.Complete);
});

test('an in-session upload is skipped before the library reloads', async () => {
    const fetch = mockUpload();
    const uploads = driveUploads();

    await uploads.upload([new File([PAYLOAD], 'proof.bin', { lastModified: 1 })]);
    await uploads.upload([new File([PAYLOAD], 'proof.bin', { lastModified: 2 })]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(uploads.jobs[0]?.result?.status).toBe(UploadStatus.AlreadyExists);
});

test('a group dedupe ignores another account file with the same name and content', async () => {
    const fetch = mockUpload();
    const members: GroupUploadMember[] = [{ email: EMAIL, token: 'aas_et/first', paused: false }];
    const uploads = driveUploads({
        files: [existingFile('proof.bin', SECOND)],
        group: members
    });

    await uploads.upload([new File([PAYLOAD], 'proof.bin')]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(uploads.jobs[0]?.result?.status).toBe(UploadStatus.Uploaded);
});
