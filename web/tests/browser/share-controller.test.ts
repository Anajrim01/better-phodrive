import { expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import type { ShareSummary } from '@madkarmaa/phodrive-core/models';

const { create, list, revoke } = await vi.hoisted(async () => ({
    create: vi.fn(),
    list: vi.fn(),
    revoke: vi.fn()
}));
vi.mock('#browser/shares', () => ({
    createShareRequest: create,
    listShares: list,
    revokeShare: revoke
}));
const { DriveShareController } = await import('#browser/drive/share.svelte');
const { DriveShares } = await import('#browser/drive/shares.svelte');

const ACTIVE_SHARE: ShareSummary = {
    id: 'revoke-me',
    kind: 'file',
    name: 'File',
    status: 'active',
    fileCount: 1,
    createdAt: '2026-11-06T00:00:00.000Z',
    revokedAt: null,
    publicPath: '/s/test'
};

test('successful revoke removes only that share from the visible list', async () => {
    const active = ACTIVE_SHARE;
    const retained = { ...active, id: 'keep-me' };
    revoke.mockReturnValue(
        Ok({ ...active, status: 'revoked' as const }).mapAsync(async (share) => share)
    );
    const feedback = vi.fn();
    const shares = new DriveShares(feedback);
    shares.shares = [active, retained];

    await shares.revoke(active.id);

    expect(shares.shares).toEqual([retained]);
    expect(feedback).toHaveBeenCalledWith('Share revoked.');
});

function deferredList() {
    let resolve!: (shares: ShareSummary[]) => void;
    const response = new Promise<ShareSummary[]>((done) => {
        resolve = done;
    });

    return {
        resolve,
        result: Ok(undefined).andThenAsync(async () => Ok(await response))
    };
}

function resolvedShare(share: ShareSummary) {
    return Ok(share).mapAsync(async (current) => current);
}

test('a list requested before a revoke cannot bring the row back', async () => {
    const kept = { ...ACTIVE_SHARE, id: 'keep-me' };
    const stale = deferredList();
    const fresh = deferredList();
    list.mockReset();
    list.mockReturnValueOnce(stale.result).mockReturnValueOnce(fresh.result);
    revoke.mockReturnValue(resolvedShare({ ...ACTIVE_SHARE, status: 'revoked' }));
    const shares = new DriveShares(() => {});
    shares.shares = [ACTIVE_SHARE, kept];

    const staleLoad = shares.load();
    await shares.revoke(ACTIVE_SHARE.id);
    expect(list).toHaveBeenCalledTimes(2);

    stale.resolve([ACTIVE_SHARE, kept]);
    await staleLoad;
    expect(shares.shares).toEqual([kept]);
    expect(shares.loading).toBe(true);

    fresh.resolve([kept]);
    await vi.waitFor(() => expect(shares.loading).toBe(false));
    expect(shares.shares).toEqual([kept]);
});

test('a list requested before a create cannot erase the new share', async () => {
    const existing = { ...ACTIVE_SHARE, id: 'existing' };
    const created = { ...ACTIVE_SHARE, id: 'created' };
    const stale = deferredList();
    list.mockReset();
    list.mockReturnValueOnce(stale.result).mockReturnValueOnce(
        Ok([created, existing]).mapAsync(async (rows) => rows)
    );
    create.mockReturnValue(resolvedShare(created));
    const controller = new DriveShareController(
        () => ({ kind: 'group', group: { id: 'group-id', name: 'Group', members: [] } }),
        () => false,
        () => {}
    );
    controller.requestFolder('parent');

    const staleLoad = controller.shares.load();
    await controller.create('Folder');
    await vi.waitFor(() => expect(controller.shares.loading).toBe(false));

    stale.resolve([existing]);
    await staleLoad;
    expect(controller.shares.shares).toEqual([created, existing]);
});

test('a repeated create response does not list the share twice', () => {
    list.mockReset();
    const shares = new DriveShares(() => {});

    shares.add(ACTIVE_SHARE);
    shares.add(ACTIVE_SHARE);

    expect(shares.shares).toEqual([ACTIVE_SHARE]);
});

test('retrying a revoked creation cannot put it back in the visible list', async () => {
    create.mockReturnValue(
        Ok({ ...ACTIVE_SHARE, status: 'revoked' as const }).mapAsync(async (share) => share)
    );
    const controller = new DriveShareController(
        () => ({ kind: 'group', group: { id: 'group-id', name: 'Group', members: [] } }),
        () => false,
        () => {}
    );
    controller.requestFolder('parent/nested');

    await controller.create('Folder');

    expect(controller.result).toBeNull();
    expect(controller.shares.shares).toEqual([]);
    expect(controller.error).toContain('revoked');
});

test('group folder creation needs no individual source account id', async () => {
    create.mockClear();
    create.mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'The response was lost.' })
        )
    );
    const controller = new DriveShareController(
        () => ({ kind: 'group', group: { id: 'group-id', name: 'Group', members: [] } }),
        () => false,
        () => {}
    );
    controller.requestFolder('parent/nested');

    await controller.create('Folder');

    expect(create).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
            kind: 'folder',
            context: { kind: 'group', id: 'group-id' },
            folder: 'parent/nested'
        })
    );
    expect(controller.busy).toBe(false);
});

test('a failed revoke reports the failure and keeps the list', async () => {
    const active = { id: 'share-id', status: 'active' };
    revoke.mockReturnValue(
        Promise.resolve(Err({ code: 'DATABASE_UNAVAILABLE', message: 'Revoke failed.' }))
    );
    const feedback = vi.fn();
    const shares = new DriveShares(feedback);
    shares.shares = [active] as never;

    await shares.revoke('share-id');

    expect(feedback).toHaveBeenCalledWith('Revoke failed.');
    expect(shares.shares).toEqual([active]);
});

test('a failed create retries with the same idempotency key', async () => {
    create.mockReturnValue(
        Promise.resolve(
            Err({
                code: 'REQUEST_FAILED',
                message: 'The response was lost.'
            })
        )
    );
    const controller = new DriveShareController(
        () => ({ kind: 'account', account: { id: 'account-id' } }) as never,
        () => false,
        () => {}
    );
    controller.requestFile({
        complete: true,
        trashed: false,
        deleted: false,
        name: 'file.bin',
        accountId: 'account-id',
        fileId: '1'.repeat(64),
        fileHash: '2'.repeat(64),
        chunks: []
    } as never);

    await controller.create('Report');
    await controller.create('Report');

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].requestKey).toBe(create.mock.calls[1]![0].requestKey);
    expect(controller.error).toBe('The response was lost.');
});
