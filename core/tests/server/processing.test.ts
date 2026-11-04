import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { uploadFiles as uploadFromBrowser } from '@madkarmaa/phodrive-core/browser/upload';
import type { UploadJob } from '@madkarmaa/phodrive-core/browser/upload/jobs';
import {
    ChunkFormat,
    ProcessingMode,
    UploadEventType,
    UploadJobStatus,
    type UploadEvent
} from '@madkarmaa/phodrive-core/models';
import type {
    ChunkMetadataRecord,
    ChunkMetadataStore
} from '@madkarmaa/phodrive-core/server/photos';
import { decodeSplitBmp, encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import { uploadFiles } from '@madkarmaa/phodrive-core/server/upload';
import { fileUploadStream, receiveFileUpload } from '@madkarmaa/phodrive-core/server/upload/file';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { TEST_ACCOUNT, uploadForm } from '../helpers/upload';
import { photosUploadHarness } from '../helpers/photos-harness';

afterEach(() => vi.restoreAllMocks());

const PAYLOAD = Buffer.from('a whole file the server splits and encodes itself');

function bmpRequest(bmp: Uint8Array, metadata = uploadForm(PAYLOAD).metadata) {
    const form = new FormData();
    form.set('metadata', JSON.stringify(metadata));
    form.set('chunk', new Blob([Uint8Array.from(bmp)]), 'chunk.bmp');

    return {
        request: new Request('http://localhost/api/upload', { method: 'POST', body: form })
    };
}

function metadataStore(): ChunkMetadataStore & { save: ReturnType<typeof vi.fn> } {
    const save = vi.fn(() => Ok(undefined).andThenAsync(async () => Ok(undefined)));

    return {
        load: () =>
            Ok(new Map<string, ChunkMetadataRecord>()).andThenAsync(async (value) => Ok(value)),
        save,
        remove: () => Ok(undefined).andThenAsync(async () => Ok(undefined))
    };
}

/** The same payload encoded with a different header, so the body hash can still be claimed. */
function mismatchedBmp(fixture: ReturnType<typeof uploadForm>) {
    const fileHash = 'b'.repeat(64);
    const header = {
        ...fixture.header,
        fileHash,
        fileId: fileIdentity('other.bin', fileHash),
        fileName: 'other.bin'
    };

    return encodeSplitBmp(PAYLOAD, header).unwrap();
}

function fileRequest(payload: Uint8Array, size = payload.length) {
    const form = new FormData();
    form.set('metadata', JSON.stringify({ name: 'whole.bin', size, workers: 2 }));
    form.set('file', new Blob([Uint8Array.from(payload)]), 'whole.bin');

    return new Request('http://localhost/api/upload', { method: 'POST', body: form });
}

function events(text: string): UploadEvent[] {
    return text
        .split('\n\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice('data: '.length)));
}

async function spoolDirectories() {
    const entries = await readdir(tmpdir());

    return entries.filter((entry) => entry.startsWith('phodrive-upload-')).length;
}

test('a browser-encoded BMP is relayed to Google byte for byte', async () => {
    const encoded = encodeSplitBmp(PAYLOAD, uploadForm(PAYLOAD).header).unwrap();
    const { request } = bmpRequest(encoded);
    const harness = photosUploadHarness();

    const received = await receiveUpload(request, TEST_ACCOUNT, ChunkFormat.Bmp);
    const input = received.unwrap();
    const emitted: UploadEvent[] = [];
    const uploaded = await uploadFiles(input, (event) => emitted.push(event), harness.fetcher);
    await input.cancel();

    expect(uploaded.isOk()).toBe(true);
    const [stored] = [...harness.stored.values()];
    expect(Buffer.from(stored).equals(Buffer.from(encoded))).toBe(true);
    expect(emitted.some((event) => event.type === UploadEventType.FileComplete)).toBe(true);
});

test('a relayed BMP shorter than its metadata declares is never committed', async () => {
    const encoded = encodeSplitBmp(PAYLOAD, uploadForm(PAYLOAD).header).unwrap();
    const { request } = bmpRequest(encoded.subarray(0, encoded.length - 1));
    const harness = photosUploadHarness();

    const received = await receiveUpload(request, TEST_ACCOUNT, ChunkFormat.Bmp);
    const input = received.unwrap();
    const uploaded = await uploadFiles(input, () => {}, harness.fetcher);
    await input.cancel();

    expect(uploaded.isErr()).toBe(true);
    expect(harness.counts.commits).toBe(0);
});

test('metadata that disagrees with the relayed BMP header is never committed or saved', async () => {
    const fixture = uploadForm(PAYLOAD);
    const body = mismatchedBmp(fixture);
    const metadata = {
        ...fixture.metadata,
        sha1: createHash('sha1').update(body).digest('hex')
    };
    const { request } = bmpRequest(body, metadata);
    const harness = photosUploadHarness();
    const store = metadataStore();

    const received = await receiveUpload(request, TEST_ACCOUNT, ChunkFormat.Bmp);
    const input = received.unwrap();
    const uploaded = await uploadFiles(input, () => {}, harness.fetcher, store);
    await input.cancel();

    expect(uploaded.isErr()).toBe(true);
    expect(harness.counts.commits).toBe(0);
    expect(store.save).not.toHaveBeenCalled();
});

test('a deduplicated SHA-1 claim never saves metadata for a different body', async () => {
    const fixture = uploadForm(PAYLOAD);
    const body = mismatchedBmp(fixture);
    const { request } = bmpRequest(body, fixture.metadata);
    const harness = photosUploadHarness({ duplicate: true });
    const store = metadataStore();

    const received = await receiveUpload(request, TEST_ACCOUNT, ChunkFormat.Bmp);
    const input = received.unwrap();
    const uploaded = await uploadFiles(input, () => {}, harness.fetcher, store);
    await input.cancel();

    expect(uploaded.isErr()).toBe(true);
    expect(harness.counts).toMatchObject({ transfers: 0, commits: 0 });
    expect(store.save).not.toHaveBeenCalled();
});

test('the server spools a whole file, uploads its chunks, and removes the spool', async () => {
    const harness = photosUploadHarness();
    const before = await spoolDirectories();

    const received = await receiveFileUpload(fileRequest(PAYLOAD));
    const response = fileUploadStream(received.unwrap(), TEST_ACCOUNT, harness.fetcher);
    const reported = events(await response.text());

    const types = reported.map((event) => event.type);
    expect(types).toContain(UploadEventType.Chunk);
    expect(types).toContain(UploadEventType.FileComplete);
    expect(types.at(-1)).toBe(UploadEventType.Complete);
    expect(
        reported.some(
            (event) =>
                event.type === UploadEventType.Progress && event.progress.phase === 'receiving'
        )
    ).toBe(true);

    const [stored] = [...harness.stored.values()];
    expect(Buffer.from(decodeSplitBmp(stored).unwrap().payload).equals(PAYLOAD)).toBe(true);
    expect(await spoolDirectories()).toBe(before);
});

test('a server-processed whole file saves its confirmed metadata row', async () => {
    const harness = photosUploadHarness();
    const store = metadataStore();
    const received = await receiveFileUpload(fileRequest(PAYLOAD));
    const response = fileUploadStream(received.unwrap(), TEST_ACCOUNT, harness.fetcher, store);
    const reported = events(await response.text());

    expect(reported.some((event) => event.type === UploadEventType.FileComplete)).toBe(true);
    expect(reported.at(-1)?.type).toBe(UploadEventType.Complete);
    expect(store.save).toHaveBeenCalledOnce();
    const saved = store.save.mock.calls[0]?.[0] as ChunkMetadataRecord[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
        mediaKey: 'media-key',
        sha1: expect.stringMatching(/^[a-f0-9]{40}$/),
        fileId: expect.any(String),
        chunkIndex: 0,
        isLast: true,
        originalName: 'whole.bin',
        size: PAYLOAD.length
    });
    expect(saved[0]?.storedBmpSize).toBeGreaterThan(PAYLOAD.length);
});

test('a whole file shorter than declared fails before anything is uploaded', async () => {
    const harness = photosUploadHarness();

    const received = await receiveFileUpload(fileRequest(PAYLOAD, PAYLOAD.length + 10));
    const response = fileUploadStream(received.unwrap(), TEST_ACCOUNT, harness.fetcher);
    const reported = events(await response.text());

    expect(reported.at(-1)).toMatchObject({ type: UploadEventType.Error });
    expect(harness.counts.transfers).toBe(0);
});

test('browsers in server mode send whole files and track the server-reported progress', async () => {
    const harness = photosUploadHarness();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const received = await receiveFileUpload(new Request(`http://localhost${url}`, init));

        return received.match({
            Ok: (file) => fileUploadStream(file, TEST_ACCOUNT, harness.fetcher),
            Err: (error) => Response.json({ error: error.message }, { status: 400 })
        });
    });
    const jobs = new Map<number, UploadJob>();
    const saved: UploadedChunk[] = [];

    const uploaded = await uploadFromBrowser(
        [new File([PAYLOAD], 'whole.bin')],
        'test@example.com',
        2,
        (job) => jobs.set(job.id, job),
        (chunk) => saved.push(chunk),
        ProcessingMode.Server
    );

    expect(uploaded.isOk()).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(jobs.get(0)?.status).toBe(UploadJobStatus.Complete);
    expect(saved).toHaveLength(1);
    expect(saved[0].fileHash).toBe(createHash('sha256').update(PAYLOAD).digest('hex'));
});
