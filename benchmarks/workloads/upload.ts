import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import { uploadFiles } from '@madkarmaa/phodrive-core/browser/upload';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import { provider } from '../transport';
import { CHUNK, MIB, files, type TransportState, type Workload } from '../fixtures';

export function uploadWorkload(name: string, transport: TransportState): Workload | undefined {
    const mixed = /^upload-mixed-(1|4|8|32)$/.test(name);
    const known =
        mixed ||
        name === 'upload-tiny' ||
        name === 'upload-many' ||
        name === 'upload-large' ||
        name === 'upload-boundaries' ||
        name === 'upload-duplicate' ||
        name === 'upload-retry';
    if (!known) return undefined;

    const sizes =
        name === 'upload-tiny'
            ? [0, 1, 1024]
            : name === 'upload-many'
              ? Array.from({ length: 300 }, () => 64 * 1024)
              : name === 'upload-large'
                ? [2 * CHUNK + MIB]
                : name === 'upload-boundaries'
                  ? [CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK + 1]
                  : name === 'upload-duplicate' || name === 'upload-retry'
                    ? [8 * MIB]
                    : [
                          ...Array.from({ length: 64 }, () => 64 * 1024),
                          ...Array.from({ length: 4 }, () => 8 * MIB),
                          CHUNK + MIB
                      ];
    const sources = files(sizes);
    const workers = Number(name.split('-').at(-1)) || 4;

    return {
        bytes: sizes.reduce((a, b) => a + b, 0),
        run: async () => {
            const harness = provider({
                duplicate: name === 'upload-duplicate',
                failCommit: name === 'upload-retry'
            });
            transport.fetcher = harness.fetcher;
            transport.fetcherWithProgress = harness.fetcherWithProgress;
            vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
                assert.equal(url, '/api/upload');
                const received = await receiveUpload(
                    new Request('http://localhost/api/upload', init)
                );

                return received.match({
                    Ok: uploadStream,
                    Err: (error) =>
                        new Response(JSON.stringify({ error: error.message }), { status: 400 })
                });
            });
            let completed = 0;
            let failed = 0;
            let chunks = 0;
            const fresh = sources.map((file) => new File([file], file.name));
            const run = () =>
                uploadFiles(
                    fresh,
                    'bench@example.com',
                    'aas_et/fixture',
                    workers,
                    (job) => {
                        if (job.status === UploadJobStatus.Complete) completed++;
                        if (job.status === UploadJobStatus.Error) failed++;
                    },
                    () => {
                        chunks++;
                    }
                );

            try {
                const result = await run();
                assert.ok(result.isOk());
                if (name === 'upload-retry') {
                    assert.equal(failed, sources.length);
                    const retried = await run();
                    assert.ok(retried.isOk());
                }
                assert.equal(completed, sources.length);
                assert.equal(
                    chunks,
                    sizes.reduce((sum, size) => sum + Math.max(1, Math.ceil(size / CHUNK)), 0)
                );
                if (name === 'upload-duplicate') assert.equal(harness.counts.transfers, 0);
                else assert.equal(harness.counts.transfers, chunks);
            } finally {
                vi.unstubAllGlobals();
            }
        }
    };
}
