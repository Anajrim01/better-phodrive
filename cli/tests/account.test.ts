import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { AAS_TOKEN, EMAIL, runCli, temporaryFolder } from './helpers/cli';

vi.mock('@madkarmaa/phodrive-core/server/accounts', () => ({ connectGoogleAccount: vi.fn() }));

let folder: Awaited<ReturnType<typeof temporaryFolder>>;

beforeEach(async () => {
    folder = await temporaryFolder();
    vi.mocked(connectGoogleAccount).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(AAS_TOKEN))
    );
});

afterEach(async () => {
    vi.clearAllMocks();
    await folder.remove();
});

async function storedConfig(path: string) {
    const text = await readFile(path, 'utf8');

    return JSON.parse(text);
}

test('adding an account stores only the validated AAS token and selects it', async () => {
    const added = await runCli(['account', 'add', EMAIL, '--token', 'oauth2_4/one-time'], {
        folder: folder.path
    });

    expect(added.exitCode).toBe(0);
    expect(connectGoogleAccount).toHaveBeenCalledWith(EMAIL, 'oauth2_4/one-time');
    expect(await storedConfig(added.configPath)).toMatchObject({
        accounts: { [EMAIL]: AAS_TOKEN },
        selected: EMAIL
    });
    expect(added.stderr).toContain(`Connected ${EMAIL}`);
});

test('a piped token keeps credentials out of the command line', async () => {
    const added = await runCli(['account', 'add', EMAIL], {
        folder: folder.path,
        input: 'oauth2_4/piped\n'
    });

    expect(added.exitCode).toBe(0);
    expect(connectGoogleAccount).toHaveBeenCalledWith(EMAIL, 'oauth2_4/piped');
});

test('missing input is explained without a terminal', async () => {
    const added = await runCli(['account', 'add'], { folder: folder.path, input: '' });

    expect(added.failures).toMatchObject([{ code: 'INPUT_REQUIRED' }]);
    expect(connectGoogleAccount).not.toHaveBeenCalled();
});

test('Google rejections are reported and nothing is saved', async () => {
    vi.mocked(connectGoogleAccount).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'AAS_AUTHENTICATION_FAILED',
                message: 'AAS authentication failed'
            } as const)
        )
    );

    const added = await runCli(['account', 'add', EMAIL, '--token', AAS_TOKEN], {
        folder: folder.path
    });

    expect(added.exitCode).toBe(1);
    expect(added.stderr).toContain('AAS authentication failed');
    await expect(readFile(added.configPath)).rejects.toThrow();
});

test('accounts are listed without tokens, switched, and removed with confirmation', async () => {
    const other = 'other@example.com';
    await runCli(['account', 'add', EMAIL, '--token', AAS_TOKEN], { folder: folder.path });
    await runCli(['account', 'add', other, '--token', AAS_TOKEN], { folder: folder.path });

    const listed = await runCli(['account', 'list', '--json'], { folder: folder.path });
    expect(JSON.parse(listed.stdout)).toEqual([
        { email: EMAIL, active: false },
        { email: other, active: true }
    ]);
    expect(listed.stdout).not.toContain('aas_et');

    const used = await runCli(['account', 'use', EMAIL], { folder: folder.path });
    expect(used.exitCode).toBe(0);

    const unconfirmed = await runCli(['account', 'remove'], { folder: folder.path });
    expect(unconfirmed.failures).toMatchObject([{ code: 'INPUT_REQUIRED' }]);
    expect(unconfirmed.stderr).toContain('--yes');

    const removed = await runCli(['account', 'remove', '--yes'], { folder: folder.path });
    expect(removed.exitCode).toBe(0);
    expect(await storedConfig(removed.configPath)).toMatchObject({
        accounts: { [other]: AAS_TOKEN },
        selected: other
    });

    const missing = await runCli(['account', 'use', EMAIL], { folder: folder.path });
    expect(missing.failures).toMatchObject([{ code: 'ACCOUNT_NOT_FOUND' }]);
});
