import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { UploadJobStatus, UploadStatus } from '@madkarmaa/phodrive-core/models';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { openLocalFiles, uploadFiles, type UploadJob } from '@madkarmaa/phodrive-core/node';
import { photosUploadHarness } from '../helpers/upload';

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-node-'));
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

async function upload(files: readonly File[], options: { duplicate?: boolean } = {}) {
    const harness = photosUploadHarness(options);
    const jobs = new Map<number, UploadJob>();
    const chunks: UploadedChunk[] = [];
    const uploaded = await uploadFiles(
        files,
        'test@example.com',
        'aas_et/test',
        2,
        (job) => jobs.set(job.id, job),
        (chunk) => chunks.push(chunk),
        { fetcher: harness.fetcher }
    );

    return { uploaded, jobs: [...jobs.values()], chunks, harness };
}

test('folders expand recursively into files named after their basenames', async () => {
    await mkdir(join(folder, 'nested', 'deeper'), { recursive: true });
    await writeFile(join(folder, 'top.txt'), 'top');
    await writeFile(join(folder, 'nested', 'deeper', 'inner.bin'), 'inner');
    const single = join(folder, 'single.txt');
    await writeFile(single, 'single');

    const opened = await openLocalFiles([join(folder, 'nested'), single]);

    const files = opened.unwrap();
    expect(files.map(({ file }) => file.name)).toEqual(['inner.bin', 'single.txt']);
    expect(files[0].path).toBe(join(folder, 'nested', 'deeper', 'inner.bin'));
    expect(await files[0].file.text()).toBe('inner');
});

test('missing paths fail before any upload starts', async () => {
    const missing = join(folder, 'missing.txt');

    const opened = await openLocalFiles([missing]);

    expect(opened.unwrapErr()).toEqual({
        code: 'FILE_READ_FAILED',
        message: `Could not read ${missing}.`
    });
});

test('local files upload in process and confirm every chunk', async () => {
    const path = join(folder, 'proof.bin');
    await writeFile(path, Buffer.from([0, 255, 13, 10, 42]));
    const opened = await openLocalFiles([path]);
    const files = opened.unwrap().map(({ file }) => file);

    const { uploaded, jobs, chunks, harness } = await upload(files);

    expect(uploaded.isOk()).toBe(true);
    expect(harness.counts).toMatchObject({ transfers: 1, commits: 1 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
        name: 'proof.bin',
        status: UploadJobStatus.Complete,
        result: { status: UploadStatus.Uploaded }
    });
    expect(chunks).toMatchObject([
        { originalName: 'proof.bin', chunkIndex: 0, isLast: true, email: 'test@example.com' }
    ]);
});

test('files already in Google Photos are reused without a transfer', async () => {
    const path = join(folder, 'proof.bin');
    await writeFile(path, 'already there');
    const opened = await openLocalFiles([path]);
    const files = opened.unwrap().map(({ file }) => file);

    const { jobs, harness } = await upload(files, { duplicate: true });

    expect(harness.counts.transfers).toBe(0);
    expect(jobs[0]).toMatchObject({
        status: UploadJobStatus.Complete,
        result: { status: UploadStatus.AlreadyExists }
    });
});

test('provider failures mark the file as failed', async () => {
    const path = join(folder, 'proof.bin');
    await writeFile(path, 'fails');
    const opened = await openLocalFiles([path]);
    const files = opened.unwrap().map(({ file }) => file);
    const harness = photosUploadHarness({ failCommit: true });
    const jobs: UploadJob[] = [];

    const uploaded = await uploadFiles(
        files,
        'test@example.com',
        'aas_et/test',
        1,
        (job) => jobs.push(job),
        () => {},
        { fetcher: harness.fetcher }
    );

    expect(uploaded.isOk()).toBe(true);
    expect(jobs.at(-1)?.status).toBe(UploadJobStatus.Error);
});
