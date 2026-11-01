// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { Err, Ok } from 'results-ts';
import { PreviewMode } from '@madkarmaa/phodrive-core/preview';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import * as previewApi from '#browser/preview';
import * as cacheApi from '#browser/preview-cache';
import FilePreviewDialog from '#components/FilePreviewDialog.svelte';

vi.mock('#browser/preview', () => ({ fetchFilePreview: vi.fn() }));
vi.mock('#browser/preview-cache', () => ({
    previewCacheKey: vi.fn(() => 'cache-key'),
    getCachedPreview: vi.fn(() => null),
    cachePreview: vi.fn()
}));

vi.hoisted(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
        })
    });
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        value: () => ({
            cancel: () => {},
            finish: () => {},
            finished: Promise.resolve(),
            addEventListener: () => {},
            removeEventListener: () => {}
        })
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: class {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.setAttribute('open', '');
            const event = new Event('toggle');
            Object.defineProperty(event, 'newState', { value: 'open' });
            this.dispatchEvent(event);
            this.querySelector<HTMLElement>('[autofocus]')?.focus();
        }
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.removeAttribute('open');
            const event = new Event('toggle');
            Object.defineProperty(event, 'newState', { value: 'closed' });
            this.dispatchEvent(event);
        }
    });
    Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: vi.fn(() => 'blob:preview')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: vi.fn()
    });
});

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

function serve(payload: previewApi.PreviewPayload) {
    vi.mocked(previewApi.fetchFilePreview).mockReturnValue(
        Ok(undefined).andThenAsync(async () => Ok(payload))
    );
}

function fail(message: string) {
    vi.mocked(previewApi.fetchFilePreview).mockReturnValue(
        Ok(undefined).andThenAsync(async () => Err({ code: 'REQUEST_FAILED', message } as const))
    );
}

function mount(item: FileGroup, overrides: Partial<ComponentProps<typeof FilePreviewDialog>> = {}) {
    const callbacks = {
        ondownload: vi.fn(),
        ondetails: vi.fn(),
        onclose: vi.fn()
    };
    const view = render(FilePreviewDialog, {
        props: {
            open: true,
            target: { kind: 'file', item },
            token: 'aas_et/test',
            ...callbacks,
            ...overrides
        }
    });

    return { ...callbacks, view };
}

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
        screen.getByText('This file type cannot be previewed here. Download it to view it.')
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

test('an image preview uses an object URL and revokes it on close', async () => {
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

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview'));
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
