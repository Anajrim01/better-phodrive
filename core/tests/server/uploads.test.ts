import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { encodeUploadBmp } from '@madkarmaa/phodrive-core/server/upload/bmp';
import { uploadFiles, planUpload } from '@madkarmaa/phodrive-core/server/upload';
import { uploadStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import { MAX_CHUNK_PAYLOAD_BYTES } from '@madkarmaa/phodrive-core/server/bmp';
import { decodeSplitBmp } from '../helpers/bmp';
import {
    UploadEventType,
    UploadStatus,
    UploadPhase,
    type UploadEvent
} from '@madkarmaa/phodrive-core/models';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { transferBmp } from '../../src/server/photos/upload/transfer';
import { uploadForm, photosUploadHarness } from '../helpers/upload';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, open: vi.fn(actual.open), mkdtemp: vi.fn(actual.mkdtemp) };
});

afterEach(() => {
    vi.restoreAllMocks();
    clearThrottleState();
});

test('multipart ingestion and BMP transfer stream without allocating files on disk', async () => {
    const fixture = uploadForm();
    const open = vi.spyOn(fs, 'open').mockRejectedValue(new Error('ENOSPC'));
    const mkdtemp = vi.spyOn(fs, 'mkdtemp').mockRejectedValue(new Error('ENOSPC'));
    const received = await receiveUpload(fixture.request());
    const input = received.unwrap();
    const harness = photosUploadHarness();
    const events: UploadEvent[] = [];
    const uploaded = await uploadFiles(input, (event) => events.push(event), harness.fetcher);
    expect(uploaded.isOk()).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(harness.counts).toMatchObject({ transfers: 1, commits: 1 });
    const bmp = harness.stored.get(fixture.metadata.sha1)!;
    expect(decodeSplitBmp(bmp).unwrap().payload).toEqual(Buffer.from([0, 255, 13, 10, 42]));
    expect(events.some((event) => event.type === UploadEventType.Chunk)).toBe(true);
    await input.cancel();
});

test('compressed uploads report stored and original sizes and commit the uploaded hash', async () => {
    const original = Buffer.alloc(2_000_000, 24);
    const fixture = uploadForm(original);
    const received = await receiveUpload(fixture.request());
    const input = received.unwrap();
    const harness = photosUploadHarness();
    const events: UploadEvent[] = [];
    const uploaded = await uploadFiles(input, (event) => events.push(event), harness.fetcher);

    expect(uploaded.isOk()).toBe(true);
    const chunk = events.find((event) => event.type === UploadEventType.Chunk);
    expect(chunk).toMatchObject({
        chunk: {
            size: original.length,
            compressed: true
        }
    });
    if (chunk?.type !== UploadEventType.Chunk) throw new Error('Missing chunk event');
    expect(chunk.chunk.storedSize).toBeLessThan(original.length / 2);
    expect(harness.stored.has(chunk.chunk.sha1)).toBe(true);
    const stored = harness.stored.get(chunk.chunk.sha1)!;
    expect(Buffer.from(decodeSplitBmp(stored).unwrap().payload)).toEqual(original);
    expect(chunk.chunk.sha1).not.toBe(fixture.metadata.sha1);
    await input.cancel();
});

test('a compressed chunk dedupes by the stored hash, not the browser BMP hash', async () => {
    const original = Buffer.alloc(2_000_000, 24);
    const harness = photosUploadHarness();

    const upload = async () => {
        const fixture = uploadForm(original);
        const input = (await receiveUpload(fixture.request())).unwrap();
        const events: UploadEvent[] = [];
        const uploaded = await uploadFiles(input, (event) => events.push(event), harness.fetcher);

        expect(uploaded.isOk()).toBe(true);
        await input.cancel();

        return { fixture, events };
    };

    const first = await upload();
    const firstChunk = first.events.find((event) => event.type === UploadEventType.Chunk);
    const firstComplete = first.events.find((event) => event.type === UploadEventType.FileComplete);
    expect(firstChunk?.type).toBe(UploadEventType.Chunk);
    expect(firstComplete).toMatchObject({ result: { status: UploadStatus.Uploaded } });
    expect(harness.counts.transfers).toBe(1);

    const second = await upload();
    const secondChunk = second.events.find((event) => event.type === UploadEventType.Chunk);
    const secondComplete = second.events.find(
        (event) => event.type === UploadEventType.FileComplete
    );
    expect(secondComplete).toMatchObject({ result: { status: UploadStatus.AlreadyExists } });
    expect(harness.counts.transfers).toBe(1);
    expect(harness.counts.commits).toBe(1);
    if (firstChunk?.type !== UploadEventType.Chunk) throw new Error('Missing first chunk');
    if (secondChunk?.type !== UploadEventType.Chunk) throw new Error('Missing second chunk');
    expect(secondChunk.chunk.sha1).toBe(firstChunk.chunk.sha1);
    expect(first.fixture.metadata.sha1).not.toBe(firstChunk.chunk.sha1);
});

test('encoder compresses repetitive chunks and hashes the bytes it uploads', async () => {
    const original = Buffer.alloc(2_000_000, 42);
    const fixture = uploadForm(original);
    const received = await receiveUpload(fixture.request());
    const input = received.unwrap();
    const encoded = await encodeUploadBmp(input);
    const source = encoded.unwrap();
    expect(source.compressed).toBe(true);
    expect(source.originalSize).toBe(original.length);
    expect(source.storedSize).toBeLessThan(original.length / 2);

    const reader = source.body.getReader();
    const hash = createHash('sha1');
    let bytes = 0;
    while (true) {
        const next = await reader.read();
        if (next.done) break;
        expect(next.value.length).toBeLessThanOrEqual(64 * 1024);
        hash.update(next.value);
        bytes += next.value.length;
    }
    expect(bytes).toBe(source.length);
    expect(hash.digest('hex')).toBe(source.sha1);
    expect(source.sha1).not.toBe(fixture.metadata.sha1);
    const verified = await source.verified;
    expect(verified.isOk()).toBe(true);
    await input.cancel();
});

test.each(['hash', 'short', 'long'] as const)(
    'invalid %s is never committed to Google',
    async (damage) => {
        const fixture = uploadForm();
        if (damage === 'hash') fixture.metadata.sha1 = 'a'.repeat(40);
        fixture.form.set('metadata', JSON.stringify(fixture.metadata));
        if (damage === 'short')
            fixture.form.set('chunk', new Blob([Uint8Array.of(1)]), 'chunk.bin');
        if (damage === 'long') fixture.form.set('chunk', new Blob([Buffer.alloc(6)]), 'chunk.bin');
        const received = await receiveUpload(fixture.request());
        const harness = photosUploadHarness();
        const uploaded = await uploadFiles(received.unwrap(), () => {}, harness.fetcher);
        expect(uploaded.isErr()).toBe(true);
        expect(harness.counts.commits).toBe(0);
        await received.unwrap().cancel();
    }
);

test('deduplication still validates the complete incoming split without a Google transfer', async () => {
    const fixture = uploadForm();
    const received = await receiveUpload(fixture.request());
    const harness = photosUploadHarness({ duplicate: true });
    const events: UploadEvent[] = [];
    const uploaded = await uploadFiles(
        received.unwrap(),
        (event) => events.push(event),
        harness.fetcher
    );
    expect(uploaded.isOk()).toBe(true);
    expect(harness.counts).toMatchObject({ transfers: 0, commits: 0 });
    expect(events.find((event) => event.type === UploadEventType.FileComplete)).toMatchObject({
        result: { status: 'already exists' }
    });
    await received.unwrap().cancel();
});

test('uncertain commits can be resolved by a stable SHA-1 lookup on retry', async () => {
    const fixture = uploadForm();
    const harness = photosUploadHarness({ failCommit: true });
    const first = await receiveUpload(fixture.request());
    const failed = await uploadFiles(first.unwrap(), () => {}, harness.fetcher);
    expect(failed.unwrapErr().code).toBe('COMMIT_OUTCOME_UNCERTAIN');
    await first.unwrap().cancel();
    const second = await receiveUpload(fixture.request());
    const retried = await uploadFiles(second.unwrap(), () => {}, harness.fetcher);
    expect(retried.isOk()).toBe(true);
    expect(harness.counts).toMatchObject({ transfers: 1, commits: 1 });
    await second.unwrap().cancel();
});

test('metadata-only preparation can describe a 500 GB source without opening or allocating that file', async () => {
    const size = 500_000_000_000;
    const plan = planUpload({ name: '500gb.bin', size, fileHash: 'a'.repeat(64) }).unwrap();
    expect(plan.headers).toHaveLength(Math.ceil(size / MAX_CHUNK_PAYLOAD_BYTES));
    expect(plan.headers.reduce((sum, header) => sum + header.payloadSize, 0)).toBe(size);
    expect(plan.headers.at(-1)?.flags).toBe(1);
    const fixture = uploadForm(new Uint8Array(), '500gb.bin', { fileSize: size });
    const received = await receiveUpload(fixture.request());
    expect(received.unwrap().header.payloadSize).toBe(MAX_CHUNK_PAYLOAD_BYTES);
    expect(received.unwrap().bmp.prefix.length).toBeLessThan(512);
    await received.unwrap().cancel();
});

test('paused downstream progress is coalesced rather than retaining every event', async () => {
    const fixture = uploadForm();
    const received = await receiveUpload(fixture.request());
    const input = received.unwrap();
    const uploads = await import('@madkarmaa/phodrive-core/server/upload');
    let finished = false;
    vi.spyOn(uploads, 'uploadFiles').mockImplementation((_input, emit) =>
        Ok(undefined).andThenAsync(async () => {
            const encoded = await encodeUploadBmp(input);
            if (encoded.isErr()) return encoded;

            const source = encoded.unwrap();
            const drained = await source.drain();
            if (drained.isErr()) return drained;

            for (let completed = 0; completed <= 10_000; completed++) {
                emit({
                    type: UploadEventType.Progress,
                    id: 0,
                    progress: {
                        phase: UploadPhase.Uploading,
                        completed,
                        reused: 0,
                        total: 10_000
                    }
                });
            }
            emit({
                type: UploadEventType.FileComplete,
                id: 0,
                result: {
                    status: UploadStatus.Uploaded,
                    mediaKey: 'key',
                    sha1: input.sha1
                }
            });
            finished = true;

            return Ok(undefined);
        })
    );
    const response = uploadStream(input);
    await vi.waitFor(() => expect(finished).toBe(true));
    const text = await response.text();
    expect(text.match(/data:/g)).toHaveLength(4);
    expect(text).toContain('"completed":10000');
    expect(text).toContain('file-complete');
    expect(text).toContain('"type":"complete"');
});

test('request cancellation closes unfinished multipart ingress and produces no confirmation', async () => {
    const fixture = uploadForm(Buffer.alloc(1_000_000));
    const abort = new AbortController();
    const request = new Request('http://localhost/api/upload', {
        method: 'POST',
        body: fixture.form,
        signal: abort.signal
    });
    const received = await receiveUpload(request);
    const encoded = await encodeUploadBmp(received.unwrap());
    const source = encoded.unwrap();
    const reader = source.body.getReader();
    await reader.read();
    abort.abort();
    await expect(reader.read()).rejects.toBeDefined();
    const verified = await source.verified;
    expect(verified.isErr()).toBe(true);
    await received.unwrap().cancel();
});

const THROTTLED_EMAIL = 'throttled@example.com';

test('a throttled chunk transfer pauses the account and later calls fail before fetch', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
    };

    const first = await transferBmp(
        THROTTLED_EMAIL,
        Buffer.from('chunk'),
        'upload-id',
        {},
        fetcher
    );
    expect(first.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 120 });

    const blocked = await transferBmp(
        THROTTLED_EMAIL,
        Buffer.from('chunk'),
        'upload-id',
        {},
        fetcher
    );
    expect(blocked.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 120 });
    expect(calls).toBe(1);
});

test('a 429 without Retry-After uses the 60 s base pause', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fetcher: Fetcher = async () => new Response(null, { status: 429 });

    const result = await transferBmp(
        THROTTLED_EMAIL,
        Buffer.from('chunk'),
        'upload-id',
        {},
        fetcher
    );

    expect(result.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 60 });
});
