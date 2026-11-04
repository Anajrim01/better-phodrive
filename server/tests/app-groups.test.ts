import { beforeEach, expect, test, vi } from 'vitest';
import { requireSessionUser } from '../src/auth';
import {
    addGoogleAccountGroupMember,
    createGoogleAccountGroup,
    deleteGoogleAccountGroup,
    listGoogleAccountGroups,
    removeGoogleAccountGroupMember,
    renameGoogleAccountGroup
} from '../src/groups';
import { ACCOUNT, USER, call, postJson, resolved } from './helpers/api';

vi.mock('../src/auth', () => ({
    createAuth: vi.fn(() => ({})),
    handleAuthRequest: vi.fn(),
    readSessionUser: vi.fn(),
    requireSessionUser: vi.fn()
}));
vi.mock('../src/groups', () => ({
    addGoogleAccountGroupMember: vi.fn(),
    createGoogleAccountGroup: vi.fn(),
    deleteGoogleAccountGroup: vi.fn(),
    listGoogleAccountGroups: vi.fn(),
    removeGoogleAccountGroupMember: vi.fn(),
    renameGoogleAccountGroup: vi.fn()
}));

const GROUP = {
    id: 'group-id',
    name: 'Team',
    members: [{ id: ACCOUNT.id, email: ACCOUNT.email }]
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSessionUser).mockReturnValue(resolved(USER));
    vi.mocked(listGoogleAccountGroups).mockReturnValue(resolved([GROUP]));
    vi.mocked(createGoogleAccountGroup).mockReturnValue(resolved(GROUP));
    vi.mocked(renameGoogleAccountGroup).mockReturnValue(resolved({ ...GROUP, name: 'Renamed' }));
    vi.mocked(addGoogleAccountGroupMember).mockReturnValue(resolved(GROUP));
    vi.mocked(removeGoogleAccountGroupMember).mockReturnValue(resolved(GROUP));
    vi.mocked(deleteGoogleAccountGroup).mockReturnValue(resolved(true));
});

test('groups are scoped to the signed-in user and return their members', async () => {
    const listed = await call('/api/account/groups');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ groups: [GROUP] });
    expect(vi.mocked(listGoogleAccountGroups).mock.calls[0][1]).toBe(USER.id);

    const created = await postJson('/api/account/groups', { name: 'Team' });
    expect(created.status).toBe(200);
    expect(vi.mocked(createGoogleAccountGroup).mock.calls[0].slice(1)).toEqual([USER.id, 'Team']);

    const renamed = await postJson('/api/account/groups/group-id', { name: 'Renamed' }, 'PUT');
    expect(renamed.status).toBe(200);
    expect(vi.mocked(renameGoogleAccountGroup).mock.calls[0].slice(1)).toEqual([
        USER.id,
        'group-id',
        'Renamed'
    ]);

    const added = await call(`/api/account/groups/group-id/members/${ACCOUNT.id}`, {
        method: 'PUT'
    });
    expect(added.status).toBe(200);
    expect(vi.mocked(addGoogleAccountGroupMember).mock.calls[0].slice(1)).toEqual([
        USER.id,
        'group-id',
        ACCOUNT.id
    ]);

    const removedMember = await call(`/api/account/groups/group-id/members/${ACCOUNT.id}`, {
        method: 'DELETE'
    });
    expect(removedMember.status).toBe(200);
    expect(vi.mocked(removeGoogleAccountGroupMember).mock.calls[0].slice(1)).toEqual([
        USER.id,
        'group-id',
        ACCOUNT.id
    ]);

    const removedGroup = await call('/api/account/groups/group-id', { method: 'DELETE' });
    expect(removedGroup.status).toBe(200);
    expect(vi.mocked(deleteGoogleAccountGroup).mock.calls[0].slice(1)).toEqual([
        USER.id,
        'group-id'
    ]);
});

test('a missing group returns 404 without echoing another user', async () => {
    vi.mocked(deleteGoogleAccountGroup).mockReturnValue(resolved(false));

    const missing = await call('/api/account/groups/group-id', { method: 'DELETE' });
    const body = (await missing.json()) as { error: string };

    expect(missing.status).toBe(404);
    expect(body.error).toBe('Group not found.');
});
