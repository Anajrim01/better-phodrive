import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import { uploadFiles } from '@madkarmaa/phodrive-core/browser/upload';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import { provider } from './transport';
import { files, type TransportState } from './fixtures';

const transport = vi.hoisted((): TransportState => ({
    fetcher: null,
    fetcherWithProgress: null
}));
vi.mock('@madkarmaa/phodrive-core/server/fetcher', () => ({
    photosFetch: (...args: Parameters<typeof fetch>) => transport.fetcher!(...args),
    photosFetchWithProgress:
        (callback: (sent: number) => void) =>
        (...args: Parameters<typeof fetch>) =>
            transport.fetcherWithProgress!(callback)(...args)
}));

const FILE_COUNT = 100;
const CONCURRENCIES = [8, 12, 16, 20];

async function measure(concurrency: number) {
    const harness = provider();
    const startedAt = performance.now();
    transport.fetcher = harness.fetcher;
    transport.fetcherWithProgress = harness.fetcherWithProgress;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        assert.equal(url, '/api/upload');
        const received = await receiveUpload(new Request('http://localhost/api/upload', init));

        return received.match({
            Ok: uploadStream,
            Err: (error) => new Response(JSON.stringify({ error: error.message }), { status: 400 })
        });
    });

    let completed = 0;
    let failed = 0;

    try {
        const sources = files(Array.from({ length: FILE_COUNT }, () => 1024));
        const fresh = sources.map((file) => new File([file], file.name));
        const result = await uploadFiles(
            fresh,
            `bench-${concurrency}@example.com`,
            'aas_et/fixture',
            concurrency,
            (job) => {
                if (job.status === UploadJobStatus.Complete) completed++;
                if (job.status === UploadJobStatus.Error) failed++;
            },
            () => {}
        );
        assert.ok(result.isOk());
        assert.equal(completed, FILE_COUNT);
        assert.equal(failed, 0);
    } finally {
        vi.unstubAllGlobals();
    }

    const protocolRequests =
        harness.counts.lookups +
        harness.counts.starts +
        harness.counts.transfers +
        harness.counts.commits;

    return {
        ...harness.counts,
        protocolRequests,
        requests: protocolRequests + harness.counts.auth,
        elapsedMs: performance.now() - startedAt
    };
}

test('batched commit request counts by upload concurrency', async () => {
    const rows: (Awaited<ReturnType<typeof measure>> & { concurrency: number })[] = [];

    for (const concurrency of CONCURRENCIES) {
        const counts = await measure(concurrency);
        rows.push({ concurrency, ...counts });
    }

    for (const row of rows) {
        console.log(
            `concurrency ${row.concurrency}: ${row.protocolRequests} protocol requests ` +
                `(${row.lookups} lookups, ${row.starts} starts, ` +
                `${row.transfers} transfers, ${row.commits} commits), ` +
                `${row.auth} auth, ${row.elapsedMs.toFixed(1)} ms`
        );
    }

    const serial = FILE_COUNT * 4;
    for (const row of rows) {
        assert.equal(row.starts, FILE_COUNT);
        assert.equal(row.transfers, FILE_COUNT);
        assert.ok(row.lookups <= Math.ceil(FILE_COUNT / row.concurrency) + 1);
        assert.ok(row.commits <= Math.ceil(FILE_COUNT / row.concurrency) + 1);
        assert.ok(row.protocolRequests < serial);
    }
    for (let index = 1; index < rows.length; index++) {
        assert.ok(rows[index].protocolRequests <= rows[index - 1].protocolRequests);
    }
});
