import { createHash } from 'node:crypto';
import type { BulkDeleteRequest } from '@madkarmaa/phodrive-core/bulk-delete';
import { writeAccountState } from '@madkarmaa/phodrive-core/server/photos/library/state';

export const EMAIL = 'test@example.com';
export const SHA1 = createHash('sha1').update('bulk route').digest('hex');

export function payload(files = 1): BulkDeleteRequest {
    return {
        email: EMAIL,
        token: 'aas_et/test',
        workers: 2,
        files: Array.from({ length: files }, (_, index) => {
            const name = `file-${index}.bin`;
            const hash = createHash('sha256').update(name).digest('hex');

            return [
                name,
                hash,
                hash,
                [[`media-${index}`, SHA1]]
            ] as BulkDeleteRequest['files'][number];
        })
    };
}

export function save(body: BulkDeleteRequest, limit?: number): void {
    const items = body.files.flatMap(([, fileHash, fileId, chunks]) =>
        chunks.slice(0, limit).map(([mediaKey, sha1]) => ({
            fileHash,
            fileId,
            chunkIndex: 0,
            isLast: true,
            size: 1,
            at: 1,
            mediaKey,
            sha1
        }))
    );
    writeAccountState(EMAIL, {
        syncToken: Buffer.from('sync'),
        revision: 1,
        items: new Map(items.map((item) => [item.mediaKey, item])),
        log: []
    });
}

export function savePartial(body: BulkDeleteRequest): void {
    save(body, 1);
}

export function request(body: unknown): Request {
    return new Request('http://localhost/api/files/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

export function parseEvents(text: string): unknown[] {
    return text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
}
