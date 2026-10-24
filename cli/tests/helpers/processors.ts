import { vi } from 'vitest';

// Worker limits follow the processor count, so tests run as if on the same machine everywhere.
vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();

    return { ...actual, availableParallelism: vi.fn(() => 16) };
});
