import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { version } from '../package.json';
import { runCli, temporaryFolder } from './helpers/cli';

const ASSET = 'phodrive-linux-x64';
const DOWNLOAD_URL = `https://github.com/madkarmaa/phodrive/releases/download/v9.9.9/${ASSET}`;
const NEW_BINARY = 'new phodrive';

let folder: Awaited<ReturnType<typeof temporaryFolder>>;
let executable: string;

beforeEach(async () => {
    folder = await temporaryFolder();
    executable = join(folder.path, 'phodrive');
    await writeFile(executable, 'old phodrive');
});

afterEach(async () => {
    vi.unstubAllGlobals();
    await folder.remove();
});

function sha256(text: string): string {
    return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function serveRelease(tag: string, assets: { name: string; size: number; digest: string }[]) {
    const fetch = vi.fn(async (url: string | URL) => {
        if (String(url) === DOWNLOAD_URL) return new Response(NEW_BINARY);

        return Response.json({
            tag_name: tag,
            assets: assets.map((asset) => ({ ...asset, browser_download_url: DOWNLOAD_URL }))
        });
    });
    vi.stubGlobal('fetch', fetch);

    return fetch;
}

function update() {
    return runCli(['update'], { folder: folder.path, release: { executable, asset: ASSET } });
}

async function leftovers() {
    const names = await readdir(folder.path);

    return names.filter((name) => name.endsWith('.part'));
}

test('builds outside a GitHub release point to npm instead', async () => {
    const fetch = serveRelease('v9.9.9', []);

    const result = await runCli(['update'], { folder: folder.path });

    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.code).toBe('UPDATE_UNSUPPORTED');
    expect(result.stderr).toContain('npm install --global @madkarmaa/phodrive-cli@latest');
    expect(fetch).not.toHaveBeenCalled();
});

test('the current release is left in place', async () => {
    const fetch = serveRelease(`v${version}`, [
        { name: ASSET, size: NEW_BINARY.length, digest: sha256(NEW_BINARY) }
    ]);

    const result = await update();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(`phodrive ${version} is up to date`);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await readFile(executable, 'utf8')).toBe('old phodrive');
});

test('a newer release replaces the executable and keeps it runnable', async () => {
    serveRelease('v9.9.9', [
        { name: 'phodrive-windows-x64.exe', size: 1, digest: sha256('other') },
        { name: ASSET, size: NEW_BINARY.length, digest: sha256(NEW_BINARY) }
    ]);

    const result = await update();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(`Updated phodrive from ${version} to 9.9.9`);
    expect(await readFile(executable, 'utf8')).toBe(NEW_BINARY);
    expect(await leftovers()).toEqual([]);
    if (process.platform !== 'win32') {
        const { mode } = await stat(executable);
        expect(mode & 0o777).toBe(0o755);
    }
});

test('a download that does not match its checksum is discarded', async () => {
    serveRelease('v9.9.9', [{ name: ASSET, size: NEW_BINARY.length, digest: sha256('tampered') }]);

    const result = await update();

    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.code).toBe('UPDATE_FAILED');
    expect(result.stderr).toContain('does not match the checksum');
    expect(await readFile(executable, 'utf8')).toBe('old phodrive');
    expect(await leftovers()).toEqual([]);
});

test('a release without a build for this system changes nothing', async () => {
    serveRelease('v9.9.9', [{ name: 'phodrive-darwin-arm64', size: 1, digest: sha256('other') }]);

    const result = await update();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`The latest release, v9.9.9, has no ${ASSET} download.`);
    expect(await readFile(executable, 'utf8')).toBe('old phodrive');
});
