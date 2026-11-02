import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { deleteFiles } from '@madkarmaa/phodrive-core/server/files';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    clearLibraryState,
    configureLibraryState,
    readAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { authResponse } from '../helpers/photos';
import { EMAIL, file, input } from '../helpers/bulk-delete';

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-permanent-response-'));
    clearAuthCache();
    clearThrottleState();
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    clearAuthCache();
    clearThrottleState();
    await rm(folder, { recursive: true, force: true });
});

test('a malformed permanent delete response leaves chunks in library state', async () => {
    const item = file('malformed-response.bin', 2, true);
    const fetcher: Fetcher = async (request) => {
        if (String(request).includes('android.googleapis.com/auth')) return authResponse();

        return new Response('not a protobuf delete result');
    };
    const results: { deleted: number; error?: string }[] = [];

    const result = await deleteFiles(
        input([item], 1, FileActionKind.DeleteForever),
        (event) => {
            results.push({
                deleted: event.deleted.length,
                ...(event.error ? { error: event.error } : {})
            });
        },
        'auto',
        fetcher
    );

    expect(result.isOk()).toBe(true);
    expect(results).toEqual([{ deleted: 0, error: 'Invalid delete response.' }]);

    const state = readAccountState(EMAIL);
    expect(state?.items.has(item.chunks[0].mediaKey)).toBe(true);
    expect(state?.items.has(item.chunks[1].mediaKey)).toBe(true);
});
