import { beforeEach, vi } from 'vitest';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';

// Worker limits follow the processor count, so tests run as if on the same machine everywhere.
vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();

    return { ...actual, availableParallelism: vi.fn(() => 16) };
});

beforeEach(() => {
    clearAuthCache();
    clearProbeCache();
    clearThrottleState();
});
