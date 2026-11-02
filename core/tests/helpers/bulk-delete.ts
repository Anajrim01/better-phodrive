import { createHash } from 'node:crypto';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { writeAccountState } from '@madkarmaa/phodrive-core/server/photos/library/state';
import type { BulkDeleteFile, BulkDeleteRequest } from '@madkarmaa/phodrive-core/bulk-delete';

export const EMAIL = 'test@example.com';

export type TestFile = BulkDeleteFile & { trashed: boolean };

export function chunk(name: string, index: number) {
    return {
        mediaKey: `${name}-${index}`,
        sha1: createHash('sha1').update(`${name}-${index}`).digest('hex')
    };
}

export function file(name: string, count: number, trashed = false): TestFile {
    const hash = createHash('sha256').update(name).digest('hex');

    return {
        name,
        fileHash: hash,
        fileId: hash,
        chunks: Array.from({ length: count }, (_, index) => chunk(name, index)),
        trashed
    };
}

function requestFile(item: BulkDeleteFile): BulkDeleteRequest['files'][number] {
    return [
        item.name,
        item.fileHash,
        item.fileId,
        item.chunks.map((entry) => [entry.mediaKey, entry.sha1])
    ];
}

export function saveState(files: readonly BulkDeleteFile[]): void {
    const items = files.flatMap((item) =>
        item.chunks.map((entry, index) => ({
            ...entry,
            fileHash: item.fileHash,
            fileId: item.fileId,
            chunkIndex: index,
            isLast: index === item.chunks.length - 1,
            size: 1,
            at: 1,
            ...('trashed' in item && item.trashed ? { trashedAt: 1 } : {})
        }))
    );
    writeAccountState(EMAIL, {
        syncToken: Buffer.from('sync'),
        revision: 3,
        items: new Map(items.map((item) => [item.mediaKey, item])),
        log: []
    });
}

export function request(
    files: readonly BulkDeleteFile[],
    workers = 2,
    action: BulkDeleteRequest['action'] = FileActionKind.Delete
): BulkDeleteRequest {
    return {
        email: EMAIL,
        token: 'aas_et/test',
        action,
        workers,
        files: files.map(requestFile)
    };
}

export function input(
    files: readonly BulkDeleteFile[],
    workers = 2,
    action: BulkDeleteRequest['action'] = FileActionKind.Delete
): BulkDeleteRequest {
    saveState(files);

    return request(files, workers, action);
}
