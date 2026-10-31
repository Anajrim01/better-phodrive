import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { readConfig, writeConfig } from '../src/config';
import { temporaryFolder, runCli } from './helpers/cli';

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';
const THIRD = 'third@example.com';

let folder: Awaited<ReturnType<typeof temporaryFolder>>;
let configPath = '';

beforeEach(async () => {
    folder = await temporaryFolder();
    configPath = join(folder.path, 'config', 'config.json');
    await writeConfig(configPath, {
        accounts: {
            [FIRST]: 'aas_et/first',
            [SECOND]: 'aas_et/second',
            [THIRD]: 'aas_et/third'
        },
        selected: FIRST,
        settings: {},
        albums: {},
        groups: []
    });
});

afterEach(async () => {
    await folder.remove();
});

async function groups() {
    return (await readConfig(configPath)).unwrap().groups;
}

test('group commands create, add, remove, list, and delete', async () => {
    const created = await runCli(
        ['group', 'create', 'Family', '--account', FIRST, '--account', SECOND],
        { folder: folder.path }
    );

    expect(created.failures).toEqual([]);
    const [group] = await groups();
    expect(group).toMatchObject({ name: 'Family', accounts: [FIRST, SECOND] });

    const listed = await runCli(['group', 'list', '--json'], { folder: folder.path });
    expect(JSON.parse(listed.stdout)).toEqual([
        { id: group.id, name: 'Family', accounts: [FIRST, SECOND] }
    ]);

    const added = await runCli(['group', 'add', 'Family', THIRD], { folder: folder.path });
    expect(added.failures).toEqual([]);
    expect((await groups())[0]?.accounts).toEqual([FIRST, SECOND, THIRD]);

    const removed = await runCli(['group', 'remove', 'Family', SECOND], {
        folder: folder.path
    });
    expect(removed.failures).toEqual([]);
    expect((await groups())[0]?.accounts).toEqual([FIRST, THIRD]);

    const deleted = await runCli(['group', 'delete', 'Family'], { folder: folder.path });
    expect(deleted.failures).toEqual([]);
    expect(await groups()).toEqual([]);
});

test('group commands reject unknown names, unknown accounts, and duplicates', async () => {
    const missing = await runCli(['group', 'add', 'Missing', FIRST], { folder: folder.path });
    expect(missing.failures[0]).toMatchObject({ code: 'GROUP_NOT_FOUND' });

    const unknown = await runCli(['group', 'create', 'Family', '--account', 'nobody@example.com'], {
        folder: folder.path
    });
    expect(unknown.failures[0]).toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });

    await runCli(['group', 'create', 'Family', '--account', FIRST], { folder: folder.path });

    const duplicateName = await runCli(['group', 'create', 'family', '--account', SECOND], {
        folder: folder.path
    });
    expect(duplicateName.failures[0]).toMatchObject({ code: 'INVALID_OPTION' });

    const duplicateAccount = await runCli(['group', 'add', 'Family', FIRST], {
        folder: folder.path
    });
    expect(duplicateAccount.failures[0]).toMatchObject({ code: 'INVALID_OPTION' });

    const lastAccount = await runCli(['group', 'remove', 'Family', FIRST], {
        folder: folder.path
    });
    expect(lastAccount.failures[0]).toMatchObject({ code: 'INVALID_OPTION' });
});
