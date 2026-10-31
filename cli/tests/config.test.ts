import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { defaultConfigPath, readConfig, writeConfig } from '../src/config';
import { AAS_TOKEN, EMAIL, temporaryFolder } from './helpers/cli';

let folder: Awaited<ReturnType<typeof temporaryFolder>>;
let path = '';

beforeEach(async () => {
    folder = await temporaryFolder();
    path = join(folder.path, 'nested', 'config.json');
});

afterEach(() => folder.remove());

test('a missing config file is empty', async () => {
    const config = await readConfig(path);

    expect(config.unwrap()).toEqual({ accounts: {}, selected: '', settings: {}, albums: {} });
});

test('the config path can be overridden', () => {
    expect(defaultConfigPath({ PHODRIVE_CONFIG: path })).toBe(path);
    expect(defaultConfigPath({})).toMatch(/phodrive[\\/]config\.json$/);
});

test('invalid accounts and settings are dropped while valid entries remain', async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
        path,
        JSON.stringify({
            accounts: {
                [EMAIL]: AAS_TOKEN,
                'bad@example.com': 'oauth2_unexchanged',
                nope: AAS_TOKEN
            },
            selected: 'not an email',
            settings: { sort: 'sideways', workers: 4 }
        })
    );

    const config = await readConfig(path);

    expect(config.unwrap()).toEqual({
        accounts: { [EMAIL]: AAS_TOKEN },
        selected: '',
        settings: { workers: 4 },
        albums: {}
    });
});

test('malformed JSON is reported instead of being overwritten', async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{ broken');

    const config = await readConfig(path);

    expect(config.unwrapErr()).toMatchObject({ code: 'CONFIG_READ_FAILED' });
    expect(await readFile(path, 'utf8')).toBe('{ broken');
});

test('saved configs are private to the current user', async () => {
    const saved = await writeConfig(path, { accounts: {}, selected: '', settings: {}, albums: {} });

    expect(saved.isOk()).toBe(true);
    if (process.platform === 'win32') return;

    const file = await stat(path);
    expect(file.mode & 0o777).toBe(0o600);
});
