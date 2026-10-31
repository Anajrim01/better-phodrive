import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import {
    SERVER_ERRORS,
    throttleError,
    type ServerError
} from '@madkarmaa/phodrive-core/server/errors';
import { downloadBmp, moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import { deleteFile, downloadFile } from '@madkarmaa/phodrive-core/node';
import { bmpResponse, downloadFixture } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn()
}));

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-node-'));
});

afterEach(async () => {
    vi.clearAllMocks();
    await rm(folder, { recursive: true, force: true });
});

function fixture(corrupt = false) {
    const data = downloadFixture();
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) => {
        const bmp = Uint8Array.from(data.bmps[Number(key.slice(-1))]);
        if (corrupt) bmp[bmp.length - 1] ^= 1;

        return Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response));
    });
    const [item] = groupChunks(
        data.input.chunks.map((chunk) => ({ ...chunk, email: data.input.email }))
    );

    return { ...data, item };
}

test('downloads are verified and saved to the destination', async () => {
    const { item, original } = fixture();
    const destination = join(folder, item.name);
    const progress: number[] = [];

    const saved = await downloadFile(item, 'aas_et/test', destination, {
        onProgress: (written) => progress.push(written)
    });

    expect(saved.isOk()).toBe(true);
    expect(await readFile(destination)).toEqual(Buffer.from(original));
    expect(progress.at(-1)).toBe(original.length);
    expect(await readdir(folder)).toEqual([item.name]);
});

test('existing files are kept unless replacement is forced', async () => {
    const { item, original } = fixture();
    const destination = join(folder, item.name);
    await writeFile(destination, 'keep me');

    const refused = await downloadFile(item, 'aas_et/test', destination);

    expect(refused.unwrapErr()).toMatchObject({ code: 'FILE_EXISTS' });
    expect(await readFile(destination, 'utf8')).toBe('keep me');
    expect(downloadBmp).not.toHaveBeenCalled();

    const replaced = await downloadFile(item, 'aas_et/test', destination, { force: true });

    expect(replaced.isOk()).toBe(true);
    expect(await readFile(destination)).toEqual(Buffer.from(original));
});

test('damaged downloads leave no partial file behind', async () => {
    const { item } = fixture(true);
    const destination = join(folder, item.name);

    const saved = await downloadFile(item, 'aas_et/test', destination);

    expect(saved.unwrapErr()).toBe(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);
    expect(await readdir(folder)).toEqual([]);
});

test('incomplete files are not downloaded', async () => {
    const { item } = fixture();
    const partial = { ...item, chunks: item.chunks.slice(1), complete: false };

    const saved = await downloadFile(partial, 'aas_et/test', join(folder, item.name));

    expect(saved.unwrapErr()).toMatchObject({ code: 'INCOMPLETE_DOWNLOAD_CHUNKS' });
});

test('delete moves every chunk to the trash', async () => {
    const { item } = fixture();
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );

    const deleted = await deleteFile(item, 'aas_et/test', 2);

    expect(deleted.unwrap().deleted).toHaveLength(item.chunks.length);
    expect(deleted.unwrap().error).toBeUndefined();
});

test('a pause while opening a later chunk keeps the throttle error', async () => {
    const data = downloadFixture();
    const [item] = groupChunks(
        data.input.chunks.map((chunk) => ({ ...chunk, email: data.input.email }))
    );
    let calls = 0;

    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) => {
        calls++;
        if (calls === 2) {
            return Ok(undefined).andThenAsync<Response, ServerError>(async () =>
                Err(throttleError(120))
            );
        }

        const bmp = Uint8Array.from(data.bmps[Number(key.slice(-1))]);

        return Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response));
    });

    const saved = await downloadFile(item, 'aas_et/test', join(folder, item.name));

    expect(saved.unwrapErr()).toMatchObject({
        code: 'THROTTLED',
        retryAfterSeconds: 120,
        message: 'Google Photos is limiting requests, retrying in about 2 min'
    });
    expect(await readdir(folder)).toEqual([]);
});
