import { expect, test } from 'vitest';
import { Ok } from 'results-ts';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import {
    UploadEventType,
    UploadJobStatus,
    UploadPhase,
    UploadStatus
} from '@madkarmaa/phodrive-core/models';
import {
    transferFiles,
    transferGroupFiles,
    type ExistingUpload,
    type GroupUploadMember
} from '@madkarmaa/phodrive-core/browser/upload';
import { hashFile, uploadIdentity } from '@madkarmaa/phodrive-core/browser/upload/hash';
import type { ChunkTransport } from '@madkarmaa/phodrive-core/browser/upload/request';
import type { UploadJob } from '@madkarmaa/phodrive-core/browser/upload/jobs';
import { planChunks } from '@madkarmaa/phodrive-core/upload';

const EMAIL = 'first@example.com';
const SHA1 = 'a'.repeat(40);

function confirmingTransport(attempts: string[]): ChunkTransport {
    return (metadata, _payload, onEvent) =>
        Ok(undefined).andThenAsync(async () => {
            attempts.push(`${metadata.email}:${metadata.file.name}`);

            const identity = (
                await uploadIdentity(
                    metadata.file.name,
                    metadata.file.fileHash,
                    metadata.file.folder ?? ''
                )
            ).unwrap();
            const plan = planChunks(
                {
                    name: metadata.file.name,
                    folder: metadata.file.folder,
                    size: metadata.file.size,
                    fileHash: metadata.file.fileHash
                },
                identity
            ).unwrap();
            const header = plan.headers[metadata.chunkIndex]!;
            const size = plan.sizes[metadata.chunkIndex]!;
            const mediaKey = `${metadata.file.name}-${header.chunkIndex}`;

            onEvent({
                type: UploadEventType.Progress,
                id: 0,
                progress: {
                    phase: UploadPhase.Uploading,
                    completed: size,
                    reused: 0,
                    total: size
                }
            });
            onEvent({
                type: UploadEventType.Chunk,
                id: 0,
                chunk: {
                    fileHash: header.fileHash,
                    fileId: header.fileId,
                    chunkIndex: header.chunkIndex,
                    isLast: header.flags === 1,
                    originalName: header.fileName,
                    folder: header.folder,
                    size: header.payloadSize,
                    at: 1,
                    mediaKey,
                    sha1: metadata.sha1
                }
            });
            onEvent({
                type: UploadEventType.FileComplete,
                id: 0,
                result: { status: UploadStatus.Uploaded, mediaKey, sha1: metadata.sha1 }
            });

            return Ok(undefined);
        });
}

async function hashOf(file: File): Promise<string> {
    return (await hashFile(file, () => {})).unwrap();
}

test('a loaded library duplicate completes without touching the transport', async () => {
    const file = new File(['same bytes'], 'proof.bin');
    const fileHash = await hashOf(file);
    const queries: { email: string; fileId: string }[] = [];
    const attempts: string[] = [];
    const jobs: UploadJob[] = [];
    const chunks: UploadedChunk[] = [];
    const existing: ExistingUpload = { mediaKey: 'existing-key', sha1: SHA1 };
    const fileId = (await uploadIdentity('proof.bin', fileHash)).unwrap();

    await transferFiles(
        [file],
        EMAIL,
        'aas_et/first',
        1,
        (job) => jobs.push(job),
        (chunk) => chunks.push(chunk),
        confirmingTransport(attempts),
        {
            existing: (query) => {
                queries.push(query);

                return query.email === EMAIL && query.fileId === fileId ? existing : null;
            }
        }
    );

    expect(attempts).toEqual([]);
    expect(chunks).toEqual([]);
    expect(queries).toEqual([{ email: EMAIL, fileId }]);
    expect(jobs.at(-1)).toMatchObject({
        status: UploadJobStatus.Complete,
        result: { status: UploadStatus.AlreadyExists, ...existing }
    });
});

test('a different folder identity is not a duplicate', async () => {
    const file = new File(['folder bytes'], 'proof.bin');
    const fileHash = await hashOf(file);
    const otherId = (await uploadIdentity('proof.bin', fileHash, 'other')).unwrap();
    const attempts: string[] = [];
    const jobs: UploadJob[] = [];

    await transferFiles(
        [file],
        EMAIL,
        'aas_et/first',
        1,
        (job) => jobs.push(job),
        () => {},
        confirmingTransport(attempts),
        {
            folder: 'current',
            existing: (query) =>
                query.fileId === otherId ? { mediaKey: 'other-folder-key', sha1: SHA1 } : null
        }
    );

    expect(attempts).toEqual([`${EMAIL}:proof.bin`]);
    expect(jobs.at(-1)?.status).toBe(UploadJobStatus.Complete);
    expect(jobs.at(-1)?.result?.status).toBe(UploadStatus.Uploaded);
});

test('identical content under a different name still uploads', async () => {
    const payload = 'shared bytes';
    const first = new File([payload], 'first.bin');
    const second = new File([payload], 'second.bin');
    const firstHash = await hashOf(first);
    const firstId = (await uploadIdentity('first.bin', firstHash)).unwrap();
    const attempts: string[] = [];
    const jobs = new Map<number, UploadJob>();

    await transferFiles(
        [first, second],
        EMAIL,
        'aas_et/first',
        1,
        (job) => jobs.set(job.id, job),
        () => {},
        confirmingTransport(attempts),
        {
            existing: (query) =>
                query.fileId === firstId ? { mediaKey: 'first-key', sha1: SHA1 } : null
        }
    );

    expect(attempts).toEqual([`${EMAIL}:second.bin`]);
    expect(jobs.get(0)?.result?.status).toBe(UploadStatus.AlreadyExists);
    expect(jobs.get(1)?.result?.status).toBe(UploadStatus.Uploaded);
});

test('a group duplicate lookup receives the owning account', async () => {
    const file = new File(['group bytes'], 'group.bin');
    const fileHash = await hashOf(file);
    const fileId = (await uploadIdentity('group.bin', fileHash)).unwrap();
    const attempts: string[] = [];
    const queries: string[] = [];
    const members: GroupUploadMember[] = [{ email: EMAIL, token: 'aas_et/first', paused: false }];

    const uploaded = await transferGroupFiles(
        [file],
        members,
        1,
        () => {},
        () => {},
        confirmingTransport(attempts),
        {
            existing: (query) => {
                queries.push(query.email);

                return query.email === EMAIL && query.fileId === fileId
                    ? { mediaKey: 'group-key', sha1: SHA1 }
                    : null;
            }
        }
    );

    expect(uploaded.unwrap()).toEqual({ waiting: 0 });
    expect(queries).toEqual([EMAIL]);
    expect(attempts).toEqual([]);
});
