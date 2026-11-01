import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { PreviewMode } from '@madkarmaa/phodrive-core/models';
import { fetchFilePreview } from '#browser/preview';
import {
    cachePreview,
    clearPreviewCache,
    getCachedPreview,
    previewCacheKey
} from '#browser/preview-cache';

const fetchMock = vi.fn();

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'photo.png',
        folder: '',
        size: 4,
        at: 1,
        mediaKey: 'media-0',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

function file(overrides: Partial<FileGroup> = {}): FileGroup {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'photo.png',
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk()],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true,
        ...overrides
    };
}

beforeEach(() => {
    clearPreviewCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterAll(() => vi.unstubAllGlobals());

test('an image response becomes an image payload', async () => {
    fetchMock.mockResolvedValue(
        new Response(new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }), {
            headers: { 'content-type': 'image/png' }
        })
    );

    const result = await fetchFilePreview(
        file(),
        'aas_et/test',
        PreviewMode.Image,
        new AbortController().signal
    );
    const payload = result.unwrap();

    expect(payload.kind).toBe('image');
    if (payload.kind !== 'image') return;

    expect(payload.contentType).toBe('image/png');
    expect(payload.blob.size).toBe(3);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
});

test('a text response becomes a bounded text payload', async () => {
    fetchMock.mockResolvedValue(Response.json({ text: 'hello', truncated: true }));

    const result = await fetchFilePreview(
        file(),
        'aas_et/test',
        PreviewMode.Text,
        new AbortController().signal
    );

    expect(result.unwrap()).toEqual({ kind: 'text', text: 'hello', truncated: true });
});

test('an unavailable response keeps its reason', async () => {
    fetchMock.mockResolvedValue(Response.json({ reason: 'binary' }));

    const result = await fetchFilePreview(
        file(),
        'aas_et/test',
        PreviewMode.Text,
        new AbortController().signal
    );

    expect(result.unwrap()).toEqual({ kind: 'unavailable', reason: 'binary' });
});

test('server errors keep their message', async () => {
    fetchMock.mockResolvedValue(
        Response.json({ error: 'Google Photos is limiting requests' }, { status: 400 })
    );

    const result = await fetchFilePreview(
        file(),
        'aas_et/test',
        PreviewMode.Image,
        new AbortController().signal
    );

    expect(result.unwrapErr()).toEqual({
        code: 'REQUEST_FAILED',
        message: 'Google Photos is limiting requests'
    });
});

test('an unreadable response becomes a preview failure', async () => {
    fetchMock.mockResolvedValue(
        new Response('not json', { headers: { 'content-type': 'application/json' } })
    );

    const result = await fetchFilePreview(
        file(),
        'aas_et/test',
        PreviewMode.Image,
        new AbortController().signal
    );

    expect(result.unwrapErr().message).toBe('Preview failed');
});

test('aborting the signal cancels the request', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                const abort = () => reject(new DOMException('Aborted', 'AbortError'));
                if (init.signal?.aborted) {
                    abort();

                    return;
                }

                init.signal?.addEventListener('abort', abort);
            })
    );

    const pending = fetchFilePreview(file(), 'aas_et/test', PreviewMode.Image, controller.signal);
    controller.abort();
    const result = await pending;

    expect(result.isErr()).toBe(true);
});

test('the cache is keyed by file hash, chunk identity, and mode', () => {
    const first = file();
    const second = file({ chunks: [chunk({ sha1: 'c'.repeat(40) })] });

    expect(previewCacheKey(first, PreviewMode.Image)).toBe(
        previewCacheKey(file(), PreviewMode.Image)
    );
    expect(previewCacheKey(first, PreviewMode.Image)).not.toBe(
        previewCacheKey(first, PreviewMode.Text)
    );
    expect(previewCacheKey(first, PreviewMode.Image)).not.toBe(
        previewCacheKey(second, PreviewMode.Image)
    );
});

test('cached payloads are reused and evicted oldest first', () => {
    cachePreview('first', { kind: 'text', text: 'first', truncated: false });
    expect(getCachedPreview('first')).toEqual({
        kind: 'text',
        text: 'first',
        truncated: false
    });

    for (let index = 0; index < 12; index++)
        cachePreview(`entry-${index}`, { kind: 'text', text: 'x', truncated: false });

    expect(getCachedPreview('first')).toBeNull();
    expect(getCachedPreview('entry-11')).not.toBeNull();
});
