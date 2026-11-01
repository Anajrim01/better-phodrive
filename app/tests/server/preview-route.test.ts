import { expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { PreviewMode, PreviewUnavailableReason } from '@madkarmaa/phodrive-core/preview';
import * as previewApi from '@madkarmaa/phodrive-core/server/preview';
import { POST } from '../../src/routes/api/files/preview/+server';

vi.mock('@madkarmaa/phodrive-core/server/preview', () => ({
    previewFile: vi.fn()
}));

const body = {
    mode: PreviewMode.Image,
    email: 'test@example.com',
    token: 'aas_et/test',
    name: 'photo.png',
    fileHash: 'a'.repeat(64),
    fileId: 'b'.repeat(64),
    chunks: [
        {
            fileHash: 'a'.repeat(64),
            fileId: 'b'.repeat(64),
            chunkIndex: 0,
            isLast: true,
            originalName: 'photo.png',
            size: 4,
            at: 1,
            mediaKey: 'media-0',
            sha1: 'c'.repeat(40)
        }
    ]
};

function request(payload: unknown = body): Request {
    return new Request('http://localhost/api/files/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

function serve(preview: previewApi.PreviewResult) {
    vi.mocked(previewApi.previewFile).mockReturnValue(
        Ok(undefined).andThenAsync(async () => Ok(preview))
    );
}

test('an image preview is returned as bytes with a safe content type', async () => {
    serve({ kind: 'image', bytes: Uint8Array.from([1, 2, 3]), contentType: 'image/png' });

    const response = await POST({ request: request() } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
});

test('a text preview is returned as bounded JSON', async () => {
    serve({ kind: 'text', text: 'hello', truncated: true });

    const response = await POST({ request: request() } as never);

    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ text: 'hello', truncated: true });
});

test('an unavailable preview carries its reason', async () => {
    serve({ kind: 'unavailable', reason: PreviewUnavailableReason.Binary });

    const response = await POST({ request: request() } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reason: 'binary' });
});

test('invalid requests and server failures become JSON errors', async () => {
    const invalid = await POST({ request: request({ mode: 'image' }) } as never);
    expect(invalid.status).toBe(400);

    vi.mocked(previewApi.previewFile).mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Preview failed' } as const)
        )
    );
    const failure = await POST({ request: request() } as never);
    expect(failure.status).toBe(400);
    await expect(failure.json()).resolves.toEqual({ error: 'Preview failed' });
});
