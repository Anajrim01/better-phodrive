import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import type { GoogleAccountGroup, GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
import { AccountsGroupsState } from '#browser/accounts-groups.svelte';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/accounts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#browser/accounts')>();

    return {
        ...actual,
        listGoogleAccounts: vi.fn(),
        listGoogleGroups: vi.fn(),
        addGoogleAccount: vi.fn(),
        removeGoogleAccount: vi.fn(),
        createGoogleGroup: vi.fn(),
        deleteGoogleGroup: vi.fn(),
        addGoogleGroupMember: vi.fn(),
        removeGoogleGroupMember: vi.fn()
    };
});

const accountsApi = await import('#browser/accounts');

const ACCOUNT: GoogleAccountSummary = { id: 'account-one', email: 'one@example.com' };
const GROUP: GoogleAccountGroup = {
    id: 'group-one',
    name: 'Group',
    members: [ACCOUNT]
};

function asyncOk<T>(value: T) {
    return Ok(value).andThenAsync(async () => Ok(value));
}

beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    vi.mocked(accountsApi.listGoogleAccounts).mockReturnValue(asyncOk([ACCOUNT]));
    vi.mocked(accountsApi.listGoogleGroups).mockReturnValue(asyncOk([GROUP]));
    for (const mutation of [
        accountsApi.addGoogleAccount,
        accountsApi.removeGoogleAccount,
        accountsApi.createGoogleGroup,
        accountsApi.deleteGoogleGroup,
        accountsApi.addGoogleGroupMember,
        accountsApi.removeGoogleGroupMember
    ])
        vi.mocked(mutation).mockReturnValue(asyncOk(undefined));
});

afterAll(() => vi.unstubAllGlobals());

test('resource mutations are refused while drive work is active', async () => {
    let blocked = true;
    const changed = vi.fn();
    const state = new AccountsGroupsState(changed, () => blocked);
    await state.load();

    expect(await state.addAccount('two@example.com', 'token')).toBe(false);
    expect(await state.disconnect(ACCOUNT)).toBe(false);
    expect(await state.createGroup('Second')).toBe(false);
    expect(await state.deleteGroup(GROUP)).toBe(false);
    expect(await state.addMember(GROUP, ACCOUNT.id)).toBe(false);
    expect(await state.removeMember(GROUP, ACCOUNT)).toBe(false);

    expect(accountsApi.addGoogleAccount).not.toHaveBeenCalled();
    expect(accountsApi.removeGoogleAccount).not.toHaveBeenCalled();
    expect(accountsApi.createGoogleGroup).not.toHaveBeenCalled();
    expect(accountsApi.deleteGoogleGroup).not.toHaveBeenCalled();
    expect(accountsApi.addGoogleGroupMember).not.toHaveBeenCalled();
    expect(accountsApi.removeGoogleGroupMember).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
});

test('resource mutations work again after drive work finishes', async () => {
    let blocked = false;
    const changed = vi.fn();
    const state = new AccountsGroupsState(changed, () => blocked);
    await state.load();

    expect(await state.createGroup('Second')).toBe(true);
    expect(accountsApi.createGoogleGroup).toHaveBeenCalledWith('Second');
    expect(changed).toHaveBeenCalledOnce();
});
