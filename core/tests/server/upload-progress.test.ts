import { expect, test } from 'vitest';
import { receiveChunk } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadFiles } from '@madkarmaa/phodrive-core/server/upload';
import {
    compressedUploadStart,
    progressCeiling,
    readProgress,
    sentProgress
} from '@madkarmaa/phodrive-core/server/upload/progress';
import { UploadEventType, type UploadEvent } from '@madkarmaa/phodrive-core/models';
import { photosUploadHarness, uploadForm } from '../helpers/upload';

test('compressed progress reads raw bytes first, then stored bytes, without an early 100%', () => {
    const total = 150_000_000;
    const raw = 140_000_000;
    const stored = 30_000_000;
    const start = compressedUploadStart(total);
    const reads = [0.25, 0.5, 0.75, 1].map((fraction) =>
        readProgress(total, Math.round(raw * fraction), raw)
    );
    const sends = [0.25, 0.5, 0.75, 1].map((fraction) =>
        sentProgress(total, Math.round(stored * fraction), stored, start)
    );
    const sequence = [0, ...reads, start, ...sends, total];

    expect(reads.every((value) => value < start)).toBe(true);
    expect(sends.every((value) => value > start && value <= progressCeiling(total))).toBe(true);
    expect(sequence).toEqual([...sequence].sort((first, second) => first - second));
    expect(Math.max(...sequence.slice(0, -1))).toBe(progressCeiling(total));
    expect(sequence.at(-1)).toBe(total);
});

test('a compressed chunk reports raw-read progress before the committed total', async () => {
    const payload = Buffer.alloc(6_000_000, 24);
    const fixture = uploadForm(payload, 'slow-read.bin', { compress: true });
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (offset >= payload.length) {
                controller.close();

                return;
            }

            const end = Math.min(offset + 64 * 1024, payload.length);
            controller.enqueue(payload.subarray(offset, end));
            offset = end;
            await new Promise((resolve) => setTimeout(resolve, 2));
        }
    });
    const input = receiveChunk(fixture.metadata, stream, new AbortController().signal).unwrap();
    const harness = photosUploadHarness();
    const events: UploadEvent[] = [];
    const uploaded = await uploadFiles(input, (event) => events.push(event), harness.fetcher);

    expect(uploaded.isOk()).toBe(true);
    const progress = events
        .filter((event) => event.type === UploadEventType.Progress)
        .map((event) => event.progress.completed);
    const start = compressedUploadStart(input.bmp.totalSize);
    expect(progress[0]).toBe(0);
    expect(progress.some((completed) => completed > 0 && completed < start)).toBe(true);
    expect(progress).toEqual([...progress].sort((first, second) => first - second));
    expect(progress.slice(0, -1).every((completed) => completed < input.bmp.totalSize)).toBe(true);
    expect(progress.at(-1)).toBe(input.bmp.totalSize);
    expect(events.findLastIndex((event) => event.type === UploadEventType.Progress)).toBeLessThan(
        events.findIndex((event) => event.type === UploadEventType.Chunk)
    );
});
