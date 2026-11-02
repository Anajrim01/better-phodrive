// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as previewApi from '#browser/preview';
import * as cacheApi from '#browser/preview-cache';
import { chunk, fail, file, mount, serve } from './file-preview-fixtures';

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

afterEach(() => cleanup());

test('an unsupported file shows the fallback without fetching', async () => {
    const { ondownload } = mount(file({ name: 'report.pdf' }));

    await screen.findByText('Preview not available');
    expect(
        screen.getByText('This file type cannot be previewed. Download it to view the full file.')
    ).toBeTruthy();
    expect(previewApi.fetchFilePreview).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(ondownload).toHaveBeenCalledWith(expect.objectContaining({ name: 'report.pdf' }));
});

test('a multi-chunk image shows the fallback without fetching', async () => {
    mount(
        file({
            name: 'photo.png',
            chunkCount: 2,
            chunks: [chunk({ isLast: false }), chunk({ chunkIndex: 1, mediaKey: 'media-1' })]
        })
    );

    await screen.findByText('Preview not available');
    expect(
        screen.getByText(
            'This image is split across several chunks, so it cannot be shown here. Download it to view the full file.'
        )
    ).toBeTruthy();
    expect(previewApi.fetchFilePreview).not.toHaveBeenCalled();
});

test('an incomplete file shows the incomplete fallback without fetching', async () => {
    mount(file({ name: 'photo.png', complete: false, chunkCount: 2 }));

    await screen.findByText('Preview not available');
    expect(screen.getByText('Load the remaining chunks before previewing this file.')).toBeTruthy();
    expect(previewApi.fetchFilePreview).not.toHaveBeenCalled();
});

test('a loading preview shows a busy state', async () => {
    vi.mocked(previewApi.fetchFilePreview).mockReturnValue(new Promise(() => {}) as never);

    mount(file());

    expect(await screen.findByText('Loading preview')).toBeTruthy();
    expect(screen.getByLabelText('Loading preview')).toBeTruthy();
});

test('text is rendered as text, never as markup, with a truncation note', async () => {
    serve({ kind: 'text', text: '<b>hello</b>', truncated: true });
    const { view } = mount(file({ name: 'notes.txt' }));

    const pre = await view.findByText('<b>hello</b>');
    expect(pre).toBeTruthy();
    expect(view.container.querySelector('pre')?.textContent).toBe('<b>hello</b>');
    expect(view.container.querySelector('pre b')).toBeNull();
    expect(
        screen.getByText('Showing the start of this file. Download it to see everything.')
    ).toBeTruthy();
});

test('an error can be retried', async () => {
    fail('Google Photos is limiting requests');
    mount(file());

    expect(await screen.findByText('Google Photos is limiting requests')).toBeTruthy();

    serve({ kind: 'text', text: 'recovered', truncated: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('recovered')).toBeTruthy();
    expect(previewApi.fetchFilePreview).toHaveBeenCalledTimes(2);
});

test('the dialog is labelled, focuses Close, and reports Escape through cancel', async () => {
    serve({ kind: 'text', text: 'hello', truncated: false });
    const { onclose } = mount(file());

    const dialog = await screen.findByRole('dialog', { name: 'photo.png' });
    await waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Close'));

    dialog.dispatchEvent(new Event('cancel'));

    expect(onclose).toHaveBeenCalled();
});

test('the owner is shown only where the app shows owners', async () => {
    serve({ kind: 'text', text: '', truncated: false });
    const { view } = mount(file({ name: 'notes.txt' }), { showOwner: true });
    await screen.findByText('owner@example.com · 4 B');

    await view.rerender({
        open: true,
        target: { kind: 'file', item: file({ name: 'notes.txt' }) },
        token: 'aas_et/test',
        showOwner: false,
        ondownload: vi.fn(),
        ondetails: vi.fn(),
        onclose: vi.fn()
    });
    expect(screen.queryByText('owner@example.com · 4 B')).toBeNull();
    expect(screen.getByText('4 B')).toBeTruthy();
});

test('the close action calls the close callback', async () => {
    serve({ kind: 'text', text: 'hello', truncated: false });
    const { onclose } = mount(file());
    await screen.findByText('hello');

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalled();
});
