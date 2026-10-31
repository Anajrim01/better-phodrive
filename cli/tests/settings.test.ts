import { mkdir, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { runCli, temporaryFolder } from './helpers/cli';

let folder: Awaited<ReturnType<typeof temporaryFolder>>;

beforeEach(async () => {
    folder = await temporaryFolder();
    vi.mocked(availableParallelism).mockReturnValue(16);
});

afterEach(() => folder.remove());

async function settings(environment: Record<string, string> = {}) {
    const shown = await runCli(['setting', 'show', '--json'], { folder: folder.path, environment });

    return JSON.parse(shown.stdout);
}

test('saved settings take precedence over deployment and built-in defaults', async () => {
    expect(await settings()).toEqual([
        { key: 'sort', value: 'modified-desc', source: 'default' },
        { key: 'workers', value: 8, source: 'default' },
        { key: 'compression', value: false, source: 'default' }
    ]);

    const environment = {
        PHODRIVE_DEFAULT_SORT: 'name-asc',
        PHODRIVE_DEFAULT_CONCURRENT_WORKERS: '3'
    };
    expect(await settings(environment)).toEqual([
        { key: 'sort', value: 'name-asc', source: 'default' },
        { key: 'workers', value: 3, source: 'default' },
        { key: 'compression', value: false, source: 'default' }
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

    const compressed = await runCli(['setting', 'set', 'compression', 'on'], {
        folder: folder.path
    });
    expect(compressed.exitCode).toBe(0);
    expect(await settings(environment)).toContainEqual({
        key: 'compression',
        value: true,
        source: 'saved'
    });

    await runCli(['setting', 'reset', 'compression'], { folder: folder.path });
    expect(await settings(environment)).toContainEqual({
        key: 'compression',
        value: false,
        source: 'default'
    });
});

test('invalid settings are rejected without saving', async () => {
    const workers = await runCli(['setting', 'set', 'workers', '17'], { folder: folder.path });
    const sort = await runCli(['setting', 'set', 'sort', 'sideways'], { folder: folder.path });
    const compression = await runCli(['setting', 'set', 'compression', 'sideways'], {
        folder: folder.path
    });
    const unknown = await runCli(['setting', 'set', 'theme', 'dark'], { folder: folder.path });

    expect(workers.exitCode).toBe(1);
    expect(workers.stderr).toContain('whole numbers from 1 to 16');
    expect(sort.failures).toMatchObject([{ code: 'INVALID_OPTION' }]);
    expect(compression.failures).toMatchObject([{ code: 'INVALID_OPTION' }]);
    expect(unknown.stderr).toContain('Unknown setting theme');
    expect(await settings()).toContainEqual({ key: 'workers', value: 8, source: 'default' });
});

test('workers follow the processors detected when the command runs', async () => {
    const saved = await runCli(['setting', 'set', 'workers', '12'], { folder: folder.path });
    expect(saved.exitCode).toBe(0);

    vi.mocked(availableParallelism).mockReturnValue(4);

    expect(await settings()).toContainEqual({ key: 'workers', value: 4, source: 'saved' });
    const rejected = await runCli(['setting', 'set', 'workers', '5'], { folder: folder.path });
    expect(rejected.stderr).toContain('whole numbers from 1 to 4');
});

test('the default fits machines with few processors and allows more than the browser', async () => {
    vi.mocked(availableParallelism).mockReturnValue(2);
    expect(await settings()).toContainEqual({ key: 'workers', value: 2, source: 'default' });

    vi.mocked(availableParallelism).mockReturnValue(64);
    const environment = { PHODRIVE_DEFAULT_CONCURRENT_WORKERS: '48' };
    expect(await settings(environment)).toContainEqual({
        key: 'workers',
        value: 48,
        source: 'default'
    });

    const configPath = join(folder.path, 'config', 'config.json');
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({ settings: { workers: 40 } }));
    expect(await settings()).toContainEqual({ key: 'workers', value: 40, source: 'saved' });
});
