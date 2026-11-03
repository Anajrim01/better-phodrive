import { expect, test } from 'vitest';
import { Ok } from 'results-ts';
import { uploadChunk } from '@madkarmaa/phodrive-core/browser/upload/chunk';
import type { ThrottleCoordinator } from '@madkarmaa/phodrive-core/browser/upload/throttle';
import type { ChunkTransport } from '@madkarmaa/phodrive-core/browser/upload/request';
import { planChunks } from '@madkarmaa/phodrive-core/upload';
import { INVALID_UPLOAD_PROGRESS } from '@madkarmaa/phodrive-core/browser/upload/request';

test('an abort after a cooldown wait stops before the transport', async () => {
    const controller = new AbortController();
    const throttle: ThrottleCoordinator = {
        pause: () => 0,
        wait: async () => {
            controller.abort();
        },
        remaining: () => 0,
        clear: () => {}
    };
    const file = new File(['cancel me'], 'cancel.bin');
    const header = planChunks(
        {
            name: file.name,
            size: file.size,
            fileHash: 'a'.repeat(64)
        },
        'b'.repeat(64)
    ).unwrap().headers[0]!;
    let attempted = false;
    const transport: ChunkTransport = () => {
        attempted = true;

        return Ok(undefined).andThenAsync(async () => Ok(undefined));
    };

    const result = await uploadChunk(
        file,
        header,
        { email: 'demo@example.com', token: 'token' },
        transport,
        () => {},
        () => Ok(undefined),
        false,
        '',
        throttle,
        controller.signal
    );

    expect(result.unwrapErr().code).toBe('UPLOAD_CANCELLED');
    expect(attempted).toBe(false);
});
