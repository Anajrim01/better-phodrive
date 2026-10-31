import { expect, test } from 'vitest';
import { Err, Ok } from 'results-ts';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { ChunkUploadRequest, UploadEvent } from '@madkarmaa/phodrive-core/models';
import {
    UploadEventType,
    UploadJobStatus,
    UploadPhase,
    UploadStatus
} from '@madkarmaa/phodrive-core/models';
import {
    transferGroupFiles,
    type GroupUploadMember
} from '@madkarmaa/phodrive-core/browser/upload';
import { uploadIdentity } from '@madkarmaa/phodrive-core/browser/upload/hash';
import type { ChunkTransport } from '@madkarmaa/phodrive-core/browser/upload/request';
import { uploadFiles, uploadGroupFiles, type UploadJob } from '@madkarmaa/phodrive-core/node';
import { planChunks } from '@madkarmaa/phodrive-core/upload';
import { photosUploadHarness } from '../helpers/upload';

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';

const members: GroupUploadMember[] = [
    { email: FIRST, token: 'aas_et/first', paused: false },
    { email: SECOND, token: 'aas_et/second', paused: false }
];

function files(): File[] {
    return [
        new File(['a'.repeat(100)], 'a.bin'),
        new File(['b'.repeat(100)], 'b.bin'),
        new File(['c'.repeat(10)], 'c.bin')
    ];
}

function successfulEvent(metadata: ChunkUploadRequest, plan: ReturnType<typeof planChunks>) {
    const ready = plan.unwrap();
    const size = ready.sizes[metadata.chunkIndex];
    const header = ready.headers[metadata.chunkIndex];
    const events: UploadEvent[] = [
        {
            type: UploadEventType.Progress,
            id: 0,
            progress: {
                phase: UploadPhase.Uploading,
                completed: size,
                reused: 0,
                total: size
            }
        },
        {
            type: UploadEventType.Chunk,
            id: 0,
            chunk: {
                fileHash: header.fileHash,
                fileId: header.fileId,
                chunkIndex: header.chunkIndex,
                isLast: Boolean(header.flags),
                originalName: header.fileName,
                folder: header.folder,
                size: header.payloadSize,
                at: 1,
                mediaKey: `${metadata.file.name}-${header.chunkIndex}`,
                sha1: metadata.sha1
            }
        },
        {
            type: UploadEventType.FileComplete,
            id: 0,
            result: {
                status: UploadStatus.Uploaded,
                mediaKey: `${metadata.file.name}-${header.chunkIndex}`,
                sha1: metadata.sha1
            }
        }
    ];

    return events;
}

function fakeTransport(
    throttle: (metadata: ChunkUploadRequest) => boolean,
    attempts: string[]
): ChunkTransport {
    const throttled = new Set<string>();

    return (metadata, _payload, onEvent) =>
        Ok(undefined).andThenAsync(async () => {
            const key = `${metadata.email}:${metadata.file.name}:${metadata.chunkIndex}`;
            attempts.push(key);
            if (throttle(metadata) && !throttled.has(key)) {
                throttled.add(key);

                return Err({
                    code: 'THROTTLED',
                    message: 'Google Photos is limiting requests',
                    retryAfterSeconds: 1
                } as const).andThenAsync(async () => Ok(undefined));
            }

            const identity = (
                await uploadIdentity(metadata.file.name, metadata.file.fileHash)
            ).unwrap();
            const plan = planChunks(
                {
                    name: metadata.file.name,
                    folder: metadata.file.folder,
                    size: metadata.file.size,
                    fileHash: metadata.file.fileHash
                },
                identity
            );

            for (const event of successfulEvent(metadata, plan)) onEvent(event);

            return Ok(undefined);
        });
}

async function runGroup(
    transport: ChunkTransport,
    group: readonly GroupUploadMember[] = members
): Promise<{
    result: Awaited<ReturnType<typeof transferGroupFiles>>;
    jobs: Map<number, UploadJob>;
}> {
    const jobs = new Map<number, UploadJob>();
    const result = await transferGroupFiles(
        files(),
        group,
        1,
        (job) => jobs.set(job.id, job),
        () => {},
        transport
    );

    return { result, jobs };
}

test('a group upload assigns whole files to two accounts through the real path', async () => {
    const harness = photosUploadHarness();
    const jobs = new Map<number, UploadJob>();
    const chunks: UploadedChunk[] = [];

    const uploaded = await uploadGroupFiles(
        files(),
        members,
        1,
        (job) => jobs.set(job.id, job),
        (chunk) => chunks.push(chunk),
        { fetcher: harness.fetcher }
    );

    expect(uploaded.unwrap()).toEqual({ waiting: 0 });
    expect([...jobs.values()].every((job) => job.status === UploadJobStatus.Complete)).toBe(true);
    expect(harness.counts.transfers).toBe(3);

    const ownerByFile = new Map(chunks.map((chunk) => [chunk.originalName, chunk.email]));
    expect(ownerByFile).toEqual(
        new Map([
            ['a.bin', FIRST],
            ['b.bin', SECOND],
            ['c.bin', FIRST]
        ])
    );
});

test('a throttled account stops taking new files while the other continues', async () => {
    const attempts: string[] = [];
    const { result, jobs } = await runGroup(
        fakeTransport(
            (metadata) => metadata.email === FIRST && metadata.file.name === 'a.bin',
            attempts
        ),
        [
            { email: FIRST, token: 'aas_et/first', paused: false },
            { email: SECOND, token: 'aas_et/second', paused: false }
        ]
    );

    expect(result.unwrap()).toEqual({ waiting: 1 });
    expect(jobs.get(0)?.status).toBe(UploadJobStatus.Complete);
    expect(jobs.get(1)?.status).toBe(UploadJobStatus.Complete);
    expect(jobs.get(2)).toMatchObject({
        status: UploadJobStatus.Queued,
        message: 'Waiting for an available account.'
    });
    expect(attempts.some((entry) => entry.startsWith(`${FIRST}:c.bin`))).toBe(false);
});

test('a member paused before the batch takes no files', async () => {
    const attempts: string[] = [];
    const { result, jobs } = await runGroup(
        fakeTransport(() => false, attempts),
        [
            { email: FIRST, token: 'aas_et/first', paused: true },
            { email: SECOND, token: 'aas_et/second', paused: false }
        ]
    );

    expect(result.unwrap()).toEqual({ waiting: 0 });
    expect(attempts).toHaveLength(3);
    expect(attempts.every((entry) => entry.startsWith(`${SECOND}:`))).toBe(true);
    expect([...jobs.values()].every((job) => job.status === UploadJobStatus.Complete)).toBe(true);
});

test('every member paused reports waiting without touching the transport', async () => {
    const attempts: string[] = [];
    const { result, jobs } = await runGroup(
        fakeTransport(() => false, attempts),
        [
            { email: FIRST, token: 'aas_et/first', paused: true },
            { email: SECOND, token: 'aas_et/second', paused: true }
        ]
    );

    expect(result.unwrap()).toEqual({ waiting: 3 });
    expect(attempts).toEqual([]);
    expect([...jobs.values()].every((job) => job.status === UploadJobStatus.Queued)).toBe(true);
});

test('an empty group upload does nothing', async () => {
    const result = await transferGroupFiles(
        [],
        members,
        1,
        () => {},
        () => {},
        fakeTransport(() => false, [])
    );

    expect(result.unwrap()).toEqual({ waiting: 0 });
});

test('an upload without a group keeps the single-account path', async () => {
    const harness = photosUploadHarness();
    const chunks: UploadedChunk[] = [];

    const uploaded = await uploadFiles(
        files(),
        FIRST,
        'aas_et/first',
        1,
        () => {},
        (chunk) => chunks.push(chunk),
        { fetcher: harness.fetcher }
    );

    expect(uploaded.isOk()).toBe(true);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.email === FIRST)).toBe(true);
    expect(harness.counts.transfers).toBe(3);
});
