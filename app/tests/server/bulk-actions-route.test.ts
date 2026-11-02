import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { createHash } from 'node:crypto';
import { deletePermanently, restoreFromTrash } from '@madkarmaa/phodrive-core/server/photos';
import {
    ensureAccountIndex,
    refreshAccountIndex
} from '@madkarmaa/phodrive-core/server/photos/library/ensure';
import type { BulkDeleteRequest } from '@madkarmaa/phodrive-core/bulk-delete';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import {
    clearLibraryState,
    configureLibraryState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { POST } from '../../src/routes/api/files/bulk/+server';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    deletePermanently: vi.fn(),
    restoreFromTrash: vi.fn()
}));

vi.mock('@madkarmaa/phodrive-core/server/photos/library/ensure', () => ({
    ensureAccountIndex: vi.fn(),
    refreshAccountIndex: vi.fn()
}));

const EMAIL = 'test@example.com';
const SHA1 = createHash('sha1').update('bulk action route').digest('hex');
let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-action-route-'));
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
    vi.mocked(ensureAccountIndex).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(refreshAccountIndex).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    vi.clearAllMocks();
    await rm(folder, { recursive: true, force: true });
});

function payload(action: BulkDeleteRequest['action']): BulkDeleteRequest {
    return {
        email: EMAIL,
        token: 'aas_et/test',
        action,
        workers: 2,
        files: Array.from({ length: 2 }, (_, index) => {
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

function save(body: BulkDeleteRequest): void {
    const items = body.files.flatMap(([, fileHash, fileId, chunks]) =>
        chunks.map(([mediaKey, sha1]) => ({
            fileHash,
            fileId,
            chunkIndex: 0,
            isLast: true,
            size: 1,
            at: 1,
            trashedAt: 1,
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

function request(body: unknown): Request {
    return new Request('http://localhost/api/files/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function parseEvents(text: string): unknown[] {
    return text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
}

test('permanent delete and restore stream their action with affected chunks', async () => {
    const scenarios = [
        { action: FileActionKind.DeleteForever, provider: deletePermanently },
        { action: FileActionKind.Restore, provider: restoreFromTrash }
    ] as const;

    for (const scenario of scenarios) {
        vi.clearAllMocks();
        vi.mocked(scenario.provider).mockImplementation(() =>
            Ok(undefined).andThenAsync(async () => Ok(undefined))
        );
        const body = payload(scenario.action);
        save(body);

        const response = await POST({ request: request(body) } as never);
        const events = parseEvents(await response.text());

        expect(response.status).toBe(200);
        expect(events).toEqual([
            {
                type: 'file',
                index: 0,
                name: 'file-0.bin',
                action: scenario.action,
                deleted: [{ mediaKey: 'media-0', sha1: SHA1 }]
            },
            {
                type: 'file',
                index: 1,
                name: 'file-1.bin',
                action: scenario.action,
                deleted: [{ mediaKey: 'media-1', sha1: SHA1 }]
            },
            { type: 'done' }
        ]);
        expect(scenario.provider).toHaveBeenCalledOnce();
    }
});
