import { afterEach, expect, test, vi } from 'vitest';
import { uploadFiles } from '#browser/files';
import { browserUploadResponse } from '../../../core/tests/helpers/upload';

const PAYLOAD = Uint8Array.of(0, 255, 13, 10, 42);
const EMAIL = 'test@example.com';
const TOKEN = 'aas_et/test';

function readMetadata(init: RequestInit | undefined): Record<string, unknown> {
    if (!(init?.body instanceof FormData)) throw new Error('Expected an upload form');
    const metadata = init.body.get('metadata');
    if (typeof metadata !== 'string') throw new Error('Expected upload metadata');

    return JSON.parse(metadata) as Record<string, unknown>;
}

afterEach(() => vi.restoreAllMocks());

test('the compress option reaches upload metadata and defaults off', async () => {
    const metadata: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        metadata.push(readMetadata(init));

        return browserUploadResponse(init);
    });

    await uploadFiles(
        [new File([PAYLOAD], 'proof.bin')],
        EMAIL,
        TOKEN,
        1,
        () => {},
        () => {},
        { compress: true }
    );
    await uploadFiles(
        [new File([PAYLOAD], 'proof.bin')],
        EMAIL,
        TOKEN,
        1,
        () => {},
        () => {}
    );

    expect(metadata[0].compress).toBe(true);
    expect(metadata[1].compress).toBe(false);
});
