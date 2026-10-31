import { UploadEventType, UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import { expect, test, vi, afterEach } from 'vitest';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { uploadFiles, type UploadJob } from '#browser/files';
import { browserUploadResponse } from '../../../core/tests/helpers/upload';

const PAYLOAD = Uint8Array.of(0, 255, 13, 10, 42);

afterEach(() => vi.restoreAllMocks());

test('an invalid uploaded SHA-1 cannot complete a browser job', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
        browserUploadResponse(init, false, (events) =>
            events.map((event) =>
                event.type === UploadEventType.Chunk
                    ? { ...event, chunk: { ...event.chunk, sha1: 'not-a-sha1' } }
                    : event
            )
        )
    );
    const jobs: UploadJob[] = [];
    const saved: UploadedChunk[] = [];
    await uploadFiles(
        [new File([PAYLOAD], 'proof.bin')],
        'test@example.com',
        'aas_et/test',
        1,
        (job) => jobs.push(job),
        (chunk) => saved.push(chunk)
    );

    expect(jobs.at(-1)?.status).toBe(UploadJobStatus.Error);
    expect(saved).toHaveLength(0);
});

test('a server-selected uploaded SHA-1 can differ from the raw browser BMP hash', async () => {
    const uploadedSha1 = 'b'.repeat(40);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
        browserUploadResponse(init, false, (events) =>
            events.map((event) => {
                if (event.type === UploadEventType.Chunk)
                    return {
                        ...event,
                        chunk: { ...event.chunk, sha1: uploadedSha1, compressed: true }
                    };
                if (event.type === UploadEventType.FileComplete)
                    return { ...event, result: { ...event.result, sha1: uploadedSha1 } };

                return event;
            })
        )
    );
    const saved: UploadedChunk[] = [];
    const uploaded = await uploadFiles(
        [new File([PAYLOAD], 'proof.bin')],
        'test@example.com',
        'aas_et/test',
        1,
        () => {},
        (chunk) => saved.push(chunk)
    );

    expect(uploaded.isOk()).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].sha1).toBe(uploadedSha1);
});

test('a raw chunk must keep the browser BMP hash', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
        browserUploadResponse(init, false, (events) =>
            events.map((event) =>
                event.type === UploadEventType.Chunk
                    ? {
                          ...event,
                          chunk: { ...event.chunk, sha1: 'b'.repeat(40), compressed: false }
                      }
                    : event
            )
        )
    );
    const jobs: UploadJob[] = [];
    const saved: UploadedChunk[] = [];
    await uploadFiles(
        [new File([PAYLOAD], 'proof.bin')],
        'test@example.com',
        'aas_et/test',
        1,
        (job) => jobs.push(job),
        (chunk) => saved.push(chunk)
    );

    expect(jobs.at(-1)?.status).toBe(UploadJobStatus.Error);
    expect(saved).toHaveLength(0);
});
