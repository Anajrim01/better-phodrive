import { afterEach, beforeEach, expect, test } from 'vitest';
import { runCli, temporaryFolder } from './helpers/cli';

let folder: Awaited<ReturnType<typeof temporaryFolder>>;

beforeEach(async () => {
    folder = await temporaryFolder();
});

afterEach(() => folder.remove());

async function settings(environment: Record<string, string> = {}) {
    const shown = await runCli(['setting', 'show', '--json'], { folder: folder.path, environment });

    return JSON.parse(shown.stdout);
}

test('saved settings take precedence over deployment and built-in defaults', async () => {
    expect(await settings()).toEqual([
        { key: 'sort', value: 'modified-desc', source: 'default' },
        { key: 'workers', value: 8, source: 'default' }
    ]);

    const environment = {
        PHODRIVE_DEFAULT_SORT: 'name-asc',
        PHODRIVE_DEFAULT_CONCURRENT_WORKERS: '3'
    };
    expect(await settings(environment)).toEqual([
        { key: 'sort', value: 'name-asc', source: 'default' },
        { key: 'workers', value: 3, source: 'default' }
    ]);

    const saved = await runCli(['setting', 'set', 'workers', '5'], { folder: folder.path });
    expect(saved.exitCode).toBe(0);
    expect(await settings(environment)).toContainEqual({
        key: 'workers',
        value: 5,
        source: 'saved'
    });

    await runCli(['setting', 'reset', 'workers'], { folder: folder.path });
    expect(await settings(environment)).toContainEqual({
        key: 'workers',
        value: 3,
        source: 'default'
    });
});

test('invalid settings are rejected without saving', async () => {
    const workers = await runCli(['setting', 'set', 'workers', '33'], { folder: folder.path });
    const sort = await runCli(['setting', 'set', 'sort', 'sideways'], { folder: folder.path });
    const unknown = await runCli(['setting', 'set', 'theme', 'dark'], { folder: folder.path });

    expect(workers.exitCode).toBe(1);
    expect(workers.stderr).toContain('whole numbers from 1 to 32');
    expect(sort.failures).toMatchObject([{ code: 'INVALID_OPTION' }]);
    expect(unknown.stderr).toContain('Unknown setting theme');
    expect(await settings()).toContainEqual({ key: 'workers', value: 8, source: 'default' });
});
