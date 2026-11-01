// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok, type Result } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { PreviewMode } from '@madkarmaa/phodrive-core/preview';
import * as previewApi from '#browser/preview';
import * as cacheApi from '#browser/preview-cache';
import { file, mount, serve } from './file-preview-fixtures';

vi.mock('#browser/preview', () => ({ fetchFilePreview: vi.fn() }));
vi.mock('#browser/preview-cache', () => ({
    previewCacheKey: vi.fn(() => 'cache-key'),
    getCachedPreview: vi.fn(() => null),
    cachePreview: vi.fn()
}));

beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(cacheApi.getCachedPreview).mockReturnValue(null);
    vi.mocked(cacheApi.previewCacheKey).mockReturnValue('cache-key');
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

test('an image preview uses an object URL and revokes it on close', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    serve({
        kind: 'image',
        blob: new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
        contentType: 'image/png'
    });
    const { view } = mount(file());

    const image = (await view.findByRole('img', {
        name: 'Preview of photo.png'
    })) as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('blob:preview');

    await view.rerender({
        open: false,
        target: { kind: 'file', item: file() },
        token: 'aas_et/test',
        ondownload: vi.fn(),
        ondetails: vi.fn(),
        onclose: vi.fn()
    });

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:preview'));
});

test('closing while loading does not apply a late result', async () => {
    let resolve: (value: Result<previewApi.PreviewPayload, ApplicationError>) => void = () => {};
    const pending = new Promise<Result<previewApi.PreviewPayload, ApplicationError>>((done) => {
        resolve = done;
    });
    vi.mocked(previewApi.fetchFilePreview).mockReturnValue(
        Ok(undefined).andThenAsync(() => pending)
    );

    const { view } = mount(file({ name: 'notes.txt' }));
    await screen.findByText('Loading preview');

    await view.rerender({
        open: false,
        target: { kind: 'file', item: file({ name: 'notes.txt' }) },
        token: 'aas_et/test',
        ondownload: vi.fn(),
        ondetails: vi.fn(),
        onclose: vi.fn()
    });

    resolve(Ok({ kind: 'text', text: 'late', truncated: false }));
    await new Promise((done) => setTimeout(done, 0));

    expect(view.container.querySelector('pre')).toBeNull();
    expect(screen.queryByText('late')).toBeNull();
});

test('a cached payload is applied without a request', async () => {
    vi.mocked(cacheApi.getCachedPreview).mockReturnValue({
        kind: 'text',
        text: 'cached',
        truncated: false
    });

    mount(file({ name: 'notes.txt' }));

    expect(await screen.findByText('cached')).toBeTruthy();
    expect(previewApi.fetchFilePreview).not.toHaveBeenCalled();
});

test('preview requests use the file mode', async () => {
    serve({ kind: 'text', text: 'hello', truncated: false });
    mount(file({ name: 'notes.txt' }));

    await screen.findByText('hello');
    expect(vi.mocked(previewApi.fetchFilePreview).mock.calls[0]?.[2]).toBe(PreviewMode.Text);
});
