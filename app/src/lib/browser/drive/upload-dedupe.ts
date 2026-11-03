import { UploadJobStatus, UploadStatus } from '@madkarmaa/phodrive-core/models';
import { folderFromFile, type FileGroup, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { ExistingUpload } from '@madkarmaa/phodrive-core/browser/upload';
import { hashFile } from '@madkarmaa/phodrive-core/browser/upload/hash';
import type { UploadJob } from '#browser/files';

export type SelectionPlan = {
    files: File[];
    jobIds: number[];
    duplicates: Map<number, number>;
};

export function uploadKey(email: string, fileId: string): string {
    return `${email.toLowerCase()}\u0000${fileId}`;
}

function contentKey(email: string, fileId: string): string {
    return `${email.toLowerCase()}\u0000${fileId}`;
}

export async function selectionPlan(
    files: readonly File[],
    jobIds: readonly number[],
    folder: string
): Promise<SelectionPlan> {
    const groups = new Map<string, number[]>();
    for (const [index, file] of files.entries()) {
        const key = `${folderFromFile(file, folder)}\u0000${file.name}\u0000${file.size}\u0000${file.lastModified}`;
        const group = groups.get(key);
        if (group) group.push(index);
        else groups.set(key, [index]);
    }

    const duplicates = new Map<number, number>();
    const dropped = new Set<number>();
    await Promise.all(
        [...groups.values()]
            .filter((indices) => indices.length > 1)
            .map(async (indices) => {
                const hashes = await Promise.all(
                    indices.map(async (index) => {
                        const hashed = await hashFile(files[index]!, () => {});

                        return hashed.isOk() ? hashed.unwrap() : null;
                    })
                );
                const primaries = new Map<string, number>();
                for (const [position, index] of indices.entries()) {
                    const fileHash = hashes[position];
                    if (!fileHash) continue;

                    const key = `${files[index]!.name}\u0000${fileHash}`;
                    const primary = primaries.get(key);
                    if (primary === undefined) {
                        primaries.set(key, index);
                        continue;
                    }

                    duplicates.set(jobIds[index]!, jobIds[primary]!);
                    dropped.add(index);
                }
            })
    );

    return {
        files: files.filter((_, index) => !dropped.has(index)),
        jobIds: jobIds.filter((_, index) => !dropped.has(index)),
        duplicates
    };
}

export function existingLookup(
    files: readonly FileGroup[],
    recent: ReadonlyMap<string, ExistingUpload>,
    pending: ReadonlySet<string>
): Map<string, ExistingUpload> {
    const lookup = new Map<string, ExistingUpload>();
    for (const file of files) {
        if (!file.complete) continue;
        if (pending.has(contentKey(file.email, file.fileId))) continue;

        const chunk = file.chunks.at(-1);
        if (!chunk) continue;

        lookup.set(uploadKey(file.email, file.fileId), {
            mediaKey: chunk.mediaKey,
            sha1: chunk.sha1
        });
    }
    for (const [key, existing] of recent) lookup.set(key, existing);

    return lookup;
}

export function pruneRecent(
    recent: Map<string, ExistingUpload>,
    files: readonly FileGroup[],
    pending: ReadonlySet<string>
): void {
    const available = new Set(
        files
            .filter((file) => file.complete && !pending.has(contentKey(file.email, file.fileId)))
            .flatMap((file) =>
                file.chunks.map(
                    (chunk) =>
                        `${chunk.email.toLowerCase()}\u0000${file.fileId}\u0000${chunk.mediaKey}\u0000${chunk.sha1}`
                )
            )
    );
    for (const [key, existing] of recent) {
        const [owner, fileId] = key.split('\u0000');
        if (
            !available.has(
                `${owner}\u0000${fileId}\u0000${existing.mediaKey}\u0000${existing.sha1}`
            )
        )
            recent.delete(key);
    }
}

export function markPending(
    chunks: readonly UploadedChunk[],
    jobs: readonly UploadJob[],
    email: string,
    pending: Set<string>
): void {
    const completed = new Set<string>();
    for (const job of jobs) {
        const result = job.result;
        if (job.status !== UploadJobStatus.Complete || !result) continue;

        const owner = (job.account ?? email).toLowerCase();
        const matching = chunks.find(
            (chunk) =>
                chunk.email.toLowerCase() === owner &&
                chunk.mediaKey === result.mediaKey &&
                chunk.sha1 === result.sha1
        );
        if (matching) completed.add(contentKey(owner, matching.fileId));
    }

    for (const chunk of chunks) {
        const key = contentKey(chunk.email, chunk.fileId);
        if (completed.has(key)) pending.delete(key);
        else pending.add(key);
    }
}

export function rememberUploads(
    chunks: readonly UploadedChunk[],
    jobs: readonly UploadJob[],
    email: string,
    recent: Map<string, ExistingUpload>
): void {
    for (const job of jobs) {
        const result = job.result;
        if (job.status !== UploadJobStatus.Complete || !result) continue;

        const owner = (job.account ?? email).toLowerCase();
        const matching = chunks.find(
            (chunk) =>
                chunk.email.toLowerCase() === owner &&
                chunk.mediaKey === result.mediaKey &&
                chunk.sha1 === result.sha1
        );
        if (!matching) continue;

        recent.set(uploadKey(owner, matching.fileId), {
            mediaKey: result.mediaKey,
            sha1: result.sha1
        });
    }
}

export function failUnfinished(
    jobs: readonly UploadJob[],
    retryId: number | undefined,
    message: string
): UploadJob[] {
    return jobs.map((job) =>
        (retryId !== undefined && job.id !== retryId) ||
        job.status === UploadJobStatus.Complete ||
        job.status === UploadJobStatus.Error
            ? job
            : { ...job, status: UploadJobStatus.Error, message }
    );
}

export function settleDuplicates(
    jobs: readonly UploadJob[],
    duplicates: ReadonlyMap<number, number>
): UploadJob[] {
    if (!duplicates.size) return [...jobs];

    const byId = new Map(jobs.map((job) => [job.id, job]));
    return jobs.map((job) => {
        const primaryId = duplicates.get(job.id);
        if (primaryId === undefined || job.status !== UploadJobStatus.Queued) return job;

        const primary = byId.get(primaryId);
        if (!primary) return job;
        if (primary.status === UploadJobStatus.Complete && primary.result)
            return {
                ...job,
                status: UploadJobStatus.Complete,
                message: '',
                result: { ...primary.result, status: UploadStatus.AlreadyExists },
                retryAt: null,
                account: primary.account
            };
        if (primary.status === UploadJobStatus.Error || primary.status === UploadJobStatus.Queued)
            return {
                ...job,
                status: primary.status,
                message: primary.message,
                retryAt: primary.retryAt,
                account: primary.account
            };

        return job;
    });
}
