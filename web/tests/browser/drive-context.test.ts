import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import type { GoogleAccountGroup, GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
import { DriveContextState } from '#browser/drive/context.svelte';
import { BrowserPreferences, DRIVE_CONTEXT_SERIALIZER } from '#browser/storage';

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
        listGoogleGroups: vi.fn()
    };
});

const accountsApi = await import('#browser/accounts');

const FIRST: GoogleAccountSummary = { id: 'account-one', email: 'one@example.com' };
const SECOND: GoogleAccountSummary = { id: 'account-two', email: 'two@example.com' };
const EMPTY_GROUP: GoogleAccountGroup = { id: 'group-empty', name: 'Empty', members: [] };
const GROUP: GoogleAccountGroup = {
    id: 'group-family',
    name: 'Family',
    members: [FIRST, SECOND]
};

function asyncOk<T>(value: T) {
    return Ok(value).andThenAsync(async () => Ok(value));
}

function preferences() {
    return new BrowserPreferences();
}

beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    vi.mocked(accountsApi.listGoogleAccounts).mockReturnValue(asyncOk([FIRST, SECOND]));
    vi.mocked(accountsApi.listGoogleGroups).mockReturnValue(asyncOk([GROUP]));
});

afterAll(() => vi.unstubAllGlobals());

test('defaults to the first connected account without creating a group', async () => {
    const state = new DriveContextState(preferences, () => {});
    await state.load();

    expect(state.current).toEqual({ kind: 'account', account: FIRST });
    expect(state.showSelector).toBe(true);
    expect(state.canUpload).toBe(true);
    expect(preferences().driveContext).toBeUndefined();
});

test('resolves a saved account or group by its stable id', async () => {
    const prefs = preferences();
    prefs.saveDriveContext({ kind: 'account', id: SECOND.id });
    const accountState = new DriveContextState(
        () => prefs,
        () => {}
    );
    await accountState.load();
    expect(accountState.current).toEqual({ kind: 'account', account: SECOND });

    prefs.saveDriveContext({ kind: 'group', id: GROUP.id });
    const groupState = new DriveContextState(
        () => prefs,
        () => {}
    );
    await groupState.load();
    expect(groupState.current).toEqual({ kind: 'group', group: GROUP });
    expect(groupState.canUpload).toBe(true);
});

test('a stale group id falls back to the first account', async () => {
    const prefs = preferences();
    prefs.saveDriveContext({ kind: 'group', id: 'group-deleted' });
    vi.mocked(accountsApi.listGoogleGroups).mockReturnValue(asyncOk([]));

    const state = new DriveContextState(
        () => prefs,
        () => {}
    );
    await state.load();

    expect(state.current).toEqual({ kind: 'account', account: FIRST });
});

test('reloading after the selected group disappears falls back to an account', async () => {
    const prefs = preferences();
    prefs.saveDriveContext({ kind: 'group', id: GROUP.id });
    const state = new DriveContextState(
        () => prefs,
        () => {}
    );
    await state.load();
    expect(state.current).toEqual({ kind: 'group', group: GROUP });

    vi.mocked(accountsApi.listGoogleGroups).mockReturnValue(asyncOk([]));
    await state.load();

    expect(state.current).toEqual({ kind: 'account', account: FIRST });
});

test('an empty group remains the selected context', async () => {
    const prefs = preferences();
    prefs.saveDriveContext({ kind: 'group', id: EMPTY_GROUP.id });
    vi.mocked(accountsApi.listGoogleGroups).mockReturnValue(asyncOk([EMPTY_GROUP]));

    const state = new DriveContextState(
        () => prefs,
        () => {}
    );
    await state.load();

    expect(state.current).toEqual({ kind: 'group', group: EMPTY_GROUP });
    expect(state.canUpload).toBe(false);
});

test('selection stores only kind and id', () => {
    const prefs = preferences();
    expect(DRIVE_CONTEXT_SERIALIZER.serialize({ kind: 'group', id: 'group-family' })).toBe(
        JSON.stringify({ kind: 'group', id: 'group-family' })
    );
    expect(
        DRIVE_CONTEXT_SERIALIZER.deserialize(JSON.stringify({ kind: 'group', id: 'group-family' }))
    ).toEqual({ kind: 'group', id: 'group-family' });
    const saved = prefs.saveDriveContext({ kind: 'group', id: 'group-family' });
    expect(saved.isOk()).toBe(true);
    expect(storage.getItem('phodrive-drive-context')).toBe(
        JSON.stringify({ kind: 'group', id: 'group-family' })
    );

    const state = new DriveContextState(
        () => prefs,
        () => {}
    );
    state.accounts = [FIRST, SECOND];
    state.groups = [GROUP];

    expect(state.select({ kind: 'group', id: GROUP.id })).toBe(true);
    expect(prefs.driveContext).toEqual({ kind: 'group', id: GROUP.id });
});

test('a single account with no groups hides the selector; any group shows it', async () => {
    vi.mocked(accountsApi.listGoogleAccounts).mockReturnValue(asyncOk([FIRST]));

    const noGroups = new DriveContextState(preferences, () => {});
    vi.mocked(accountsApi.listGoogleGroups).mockReturnValue(asyncOk([]));
    await noGroups.load();
    expect(noGroups.showSelector).toBe(false);

    const withGroup = new DriveContextState(preferences, () => {});
    vi.mocked(accountsApi.listGoogleGroups).mockReturnValue(asyncOk([EMPTY_GROUP]));
    await withGroup.load();
    expect(withGroup.showSelector).toBe(true);
});
