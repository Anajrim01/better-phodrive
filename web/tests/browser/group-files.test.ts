import { FileActionKind, ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { groupChunks, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { DriveController } from '#browser/drive/index.svelte';
import * as filesApi from '#browser/files';
import { SECOND_ACCOUNT, TEST_ACCOUNT, useGroup } from '../helpers/drive';
import { chunk } from '../helpers/files';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

const GROUP = {
    id: 'group',
    name: 'Group',
    members: [TEST_ACCOUNT, SECOND_ACCOUNT]
};

function owned(accountId: string, email: string): UploadedChunk {
    return { ...chunk(), email, accountId };
}

function libraryWithCollision(drive: DriveController) {
    const first = owned(TEST_ACCOUNT.id, TEST_ACCOUNT.email);
    const second = owned(SECOND_ACCOUNT.id, SECOND_ACCOUNT.email);
    const files = groupChunks([first, second]);
    drive.library.chunks = [first, second];

    return {
        files,
        second: files.find((file) => file.accountId === SECOND_ACCOUNT.id)!
    };
}

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('deleting a group file routes to its owner and does not reload the library', async () => {
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useGroup(drive, GROUP);
    const { second } = libraryWithCollision(drive);
    const load = vi.spyOn(drive.library, 'load');
    const refresh = vi.spyOn(drive.library, 'refresh');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        expect(new Headers(init?.headers).get('x-phodrive-account-id')).toBe(SECOND_ACCOUNT.id);
        const body = JSON.parse(String(init?.body)) as {
            chunks: Array<Record<string, unknown>>;
        };
        expect(body).not.toHaveProperty('email');
        expect(body).not.toHaveProperty('accountId');
        for (const item of body.chunks) {
            expect(item).not.toHaveProperty('email');
            expect(item).not.toHaveProperty('accountId');
        }
        expect(String(init?.body)).not.toContain(SECOND_ACCOUNT.id);
        expect(String(init?.body)).not.toContain(SECOND_ACCOUNT.email);

        return Response.json({ applied: body.chunks });
    });

    await drive.actOnFile(second, FileActionKind.Delete);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/library'))).toBe(false);
    expect(drive.library.files).toHaveLength(1);
    expect(drive.library.files[0]?.accountId).toBe(TEST_ACCOUNT.id);
});

test('downloading a group file does not reload the library', async () => {
    const drive = new DriveController('test@example.com', undefined, ProcessingMode.Server);
    drive.initialize();
    useGroup(drive, GROUP);
    const { second } = libraryWithCollision(drive);
    const load = vi.spyOn(drive.library, 'load');
    const refresh = vi.spyOn(drive.library, 'refresh');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        expect(new Headers(init?.headers).get('x-phodrive-account-id')).toBe(SECOND_ACCOUNT.id);
        const body = JSON.parse(String(init?.body)) as {
            chunks: Array<Record<string, unknown>>;
        };
        expect(body).not.toHaveProperty('email');
        expect(body).not.toHaveProperty('accountId');
        for (const item of body.chunks) {
            expect(item).not.toHaveProperty('email');
            expect(item).not.toHaveProperty('accountId');
        }
        expect(String(init?.body)).not.toContain(SECOND_ACCOUNT.id);
        expect(String(init?.body)).not.toContain(SECOND_ACCOUNT.email);

        return new Response(new Uint8Array([1, 2, 3]));
    });
    vi.spyOn(filesApi, 'saveDownloadedFile').mockReturnValue(Ok(undefined));

    await drive.actOnFile(second, FileActionKind.Download);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/library'))).toBe(false);
});
