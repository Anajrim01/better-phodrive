import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { receiveUpload, receiveChunk } from '@madkarmaa/phodrive-core/server/upload/input';
import { encodeUploadBmp } from '@madkarmaa/phodrive-core/server/upload/bmp';
import { uploadFiles } from '@madkarmaa/phodrive-core/server/upload';
import { UploadEventType, UploadStatus, type UploadEvent } from '@madkarmaa/phodrive-core/models';
import { decodeSplitBmp } from '../helpers/bmp';
import { uploadForm, photosUploadHarness } from '../helpers/upload';

function deferred() {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((settle) => {
        resolve = settle;
    });

    return { promise, resolve };
}

test('compressed uploads report stored and original sizes and commit the uploaded hash', async () => {
    const original = Buffer.alloc(2_000_000, 24);
    const fixture = uploadForm(original, 'proof.bin', { compress: true });
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
        const fixture = uploadForm(original, 'proof.bin', { compress: true });
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
    const fixture = uploadForm(original, 'proof.bin', { compress: true });
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

test('compress off does not probe or read the payload before the body starts', async () => {
    const payload = new Uint8Array(64 * 1024).fill(5);
    const fixture = uploadForm(payload);
    let pulls = 0;
    let offset = 0;
    let readAhead = 0;
    const stream = new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                pulls++;
                if (offset >= payload.length) {
                    controller.close();
                    return;
                }
                controller.enqueue(payload.subarray(offset, offset + 1024));
                offset += 1024;
                readAhead = Math.max(readAhead, offset);
            }
        },
        { highWaterMark: 0 }
    );
    const input = receiveChunk(fixture.metadata, stream, new AbortController().signal).unwrap();
    const source = (await encodeUploadBmp(input)).unwrap();

    expect(pulls).toBe(0);
    expect(readAhead).toBe(0);
    expect(source.compressed).toBe(false);
    expect(source.length).toBe(input.bmp.totalSize);
    expect(source.sha1).toBe(input.sha1);
    await input.cancel();
});

test.each([85 * 1024 - 1, 85 * 1024, 85 * 1024 + 1, 512 * 1024, 1024 * 1024])(
    'compress true keeps an incompressible %i-byte chunk raw with bounded read-ahead',
    async (size) => {
        const payload = new Uint8Array(randomBytes(size));
        const fixture = uploadForm(payload, 'probe.bin', { compress: true });
        const pattern = [7 * 1024, 13 * 1024, 64 * 1024, 1, 31 * 1024];
        let index = 0;
        let offset = 0;
        let readAhead = 0;
        const stream = new ReadableStream<Uint8Array>(
            {
                pull(controller) {
                    if (offset >= payload.length) {
                        controller.close();
                        return;
                    }

                    const block = pattern[index % pattern.length];
                    index++;
                    const end = Math.min(offset + block, payload.length);
                    controller.enqueue(payload.subarray(offset, end));
                    offset = end;
                    readAhead = Math.max(readAhead, offset);
                }
            },
            { highWaterMark: 0 }
        );
        const input = receiveChunk(fixture.metadata, stream, new AbortController().signal).unwrap();
        const source = (await encodeUploadBmp(input)).unwrap();

        expect(readAhead).toBeLessThan(256 * 1024);
        expect(source.compressed).toBe(false);
        expect(source.sha1).toBe(fixture.metadata.sha1);
        expect((await source.drain()).isOk()).toBe(true);
        await input.cancel();
    }
);

test('three buffered chunks queue the third and never exceed two', async () => {
    const payload = new Uint8Array(512 * 1024).fill(42);
    const fixture = uploadForm(payload, 'queued.bin', { compress: true });
    const gates = [deferred(), deferred(), deferred()];
    const secondReads = [0, 0, 0];
    const inputs = secondReads.map((_, index) => {
        let offset = 0;
        let reads = 0;
        const stream = new ReadableStream<Uint8Array>(
            {
                async pull(controller) {
                    if (reads === 0) {
                        reads++;
                        controller.enqueue(payload.subarray(0, 85 * 1024));
                        offset = 85 * 1024;

                        return;
                    }
                    if (reads === 1) {
                        reads++;
                        secondReads[index] = 1;
                        await gates[index].promise;
                    }
                    if (offset >= payload.length) {
                        controller.close();

                        return;
                    }

                    const end = Math.min(offset + 64 * 1024, payload.length);
                    controller.enqueue(payload.subarray(offset, end));
                    offset = end;
                }
            },
            { highWaterMark: 0 }
        );

        return receiveChunk(fixture.metadata, stream, new AbortController().signal).unwrap();
    });

    const encodes = inputs.map((input) => encodeUploadBmp(input));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondReads.filter(Boolean)).toHaveLength(2);

    gates[0].resolve();
    gates[1].resolve();
    const firstSources = await Promise.all(encodes.slice(0, 2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondReads[2]).toBe(0);

    await firstSources[0].unwrap().body.cancel();
    await firstSources[1].unwrap().body.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondReads[2]).toBe(1);

    gates[2].resolve();
    const third = await encodes[2];
    expect(third.isOk()).toBe(true);
    await third.unwrap().body.cancel();
    for (const input of inputs) await input.cancel();
});

test('draining a completed body releases its buffered slot', async () => {
    const payload = new Uint8Array(512 * 1024).fill(42);
    const fixture = uploadForm(payload, 'drained.bin', { compress: true });
    const inputs = [0, 1, 2].map(() => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(payload);
                controller.close();
            }
        });

        return receiveChunk(fixture.metadata, stream, new AbortController().signal).unwrap();
    });
    const encodes = inputs.map((input) => encodeUploadBmp(input));
    const [first, second] = await Promise.all(encodes.slice(0, 2));
    let settled = false;
    void encodes[2].then(() => {
        settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    await first.unwrap().drain();
    await second.unwrap().drain();
    const third = await encodes[2];
    expect(third.isOk()).toBe(true);
    await third.unwrap().drain();
    for (const input of inputs) await input.cancel();
});
