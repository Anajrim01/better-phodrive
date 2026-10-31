import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { test, vi } from 'vitest';
import { MIB, type TransportState } from './fixtures';
import { createWorkload } from './workloads';

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

const name = process.env.PHODRIVE_PERF_CASE;

test(`performance: ${name}`, async () => {
    assert.ok(name);
    const { run, bytes } = await createWorkload(name, transport);
    await run();
    await run();
    const samplesMs: number[] = [];
    let peakExternal = 0;
    let peakHeap = 0;
    const sampleMemory = () => {
        const memory = process.memoryUsage();
        peakExternal = Math.max(peakExternal, memory.external);
        peakHeap = Math.max(peakHeap, memory.heapUsed);
    };
    const timer = setInterval(sampleMemory, 5);

    try {
        for (let sample = 0; sample < 5; sample++) {
            sampleMemory();
            const start = performance.now();
            await run();
            samplesMs.push(performance.now() - start);
            sampleMemory();
        }
    } finally {
        clearInterval(timer);
    }

    const medianMs = samplesMs.toSorted((a, b) => a - b)[2];
    const result = {
        name,
        samplesMs,
        medianMs,
        bytes,
        mibPerSecond: bytes / MIB / (medianMs / 1000),
        peakRssMiB: process.resourceUsage().maxRSS / 1024,
        peakExternalMiB: peakExternal / MIB,
        peakHeapMiB: peakHeap / MIB
    };

    await writeFile(process.env.PHODRIVE_PERF_RESULT!, JSON.stringify(result));
});
