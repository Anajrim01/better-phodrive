import { fileKey, type FileGroup, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import type { UploadJob } from '#browser/files';

function chunkKey(chunk: UploadedChunk): string {
    return `${fileKey(chunk)}:${chunk.chunkIndex}`;
}

/** Whether the listed file still has exactly the chunks the user confirmed deleting. */
export function unchangedFile(
    current: FileGroup | undefined,
    confirmed: FileGroup
): current is FileGroup {
    if (!current) return false;
    if (current.name !== confirmed.name) return false;
    if (current.chunks.length !== confirmed.chunks.length) return false;

    return current.chunks.every((chunk) =>
        confirmed.chunks.some(
            (saved) =>
                saved.mediaKey === chunk.mediaKey &&
                saved.sha1 === chunk.sha1 &&
                saved.chunkIndex === chunk.chunkIndex
        )
    );
}

/** Add confirmed chunks, replacing any earlier copy of the same chunk. */
export function withChunks(
    chunks: readonly UploadedChunk[],
    saved: readonly UploadedChunk[]
): UploadedChunk[] {
    const added = new Set(saved.map(chunkKey));

    return [...saved, ...chunks.filter((item) => !added.has(chunkKey(item)))];
}

/** Remove one stored chunk of a file once Google has deleted it. */
export function withoutChunk(
    chunks: readonly UploadedChunk[],
    file: FileGroup,
    removed: { mediaKey: string; sha1: string }
): UploadedChunk[] {
    return chunks.filter((saved) => !sameChunk(saved, file, removed));
}

function sameChunk(
    saved: UploadedChunk,
    file: FileGroup,
    target: { mediaKey: string; sha1: string }
): boolean {
    return (
        fileKey(saved) === fileKey(file) &&
        saved.mediaKey === target.mediaKey &&
        saved.sha1 === target.sha1
    );
}

/** Mark one stored chunk as trashed or active after Google confirms the mutation. */
export function withTrashState(
    chunks: readonly UploadedChunk[],
    file: FileGroup,
    target: { mediaKey: string; sha1: string },
    trashed: boolean
): UploadedChunk[] {
    return chunks.map((saved) => {
        if (!sameChunk(saved, file, target)) return saved;
        if (trashed) return { ...saved, trashed: true };

        const { trashed: _trashed, ...active } = saved;

        return active;
    });
}

export function replaceJob(jobs: readonly UploadJob[], id: number, job: UploadJob): UploadJob[] {
    return jobs.map((current) => (current.id === id ? { ...job, id } : current));
}

function finished(job: UploadJob): boolean {
    return job.status === UploadJobStatus.Complete || job.status === UploadJobStatus.Error;
}

/** Mark a queue's unfinished jobs as failed; a retry only touches its own job. */
export function failUnfinishedJobs(
    jobs: readonly UploadJob[],
    message: string,
    jobIds?: readonly number[]
): UploadJob[] {
    return jobs.map((job) => {
        const inBatch = !jobIds || jobIds.includes(job.id);
        if (!inBatch || finished(job)) return job;

        return { ...job, status: UploadJobStatus.Error, message };
    });
}

/**
 * Hold each job's confirmed chunks until its upload ends, so an unfinished file is never offered
 * for download. A failed upload still releases its chunks, so they can be found and deleted.
 */
export function holdUploadedChunks(onRelease: (chunks: UploadedChunk[]) => void) {
    const pending = new Map<number, UploadedChunk[]>();
    const release = (jobId: number) => {
        const chunks = pending.get(jobId);
        pending.delete(jobId);
        if (chunks?.length) onRelease(chunks);
    };

    return {
        hold: (chunk: UploadedChunk, jobId: number) => {
            pending.set(jobId, [...(pending.get(jobId) ?? []), chunk]);
        },
        settle: (job: UploadJob) => {
            if (finished(job)) release(job.id);
        },
        releaseAll: () => {
            for (const jobId of [...pending.keys()]) release(jobId);
        }
    };
}
