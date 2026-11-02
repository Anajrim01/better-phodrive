// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import FileDrop from '#components/FileDrop.svelte';

vi.hoisted(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
            matches: query === '(width > 800px) and (hover: hover) and (pointer: fine)',
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
});

afterEach(() => cleanup());

function children() {
    return createRawSnippet(() => ({
        render: () => '<div data-testid="drop-zone">Files</div>'
    }));
}

function fileEntry(name: string, file: File, delayed = false): FileSystemFileEntry {
    return {
        name,
        isFile: true,
        isDirectory: false,
        file(success: (value: File) => void) {
            if (delayed) {
                setTimeout(() => success(file), 0);
                return;
            }

            success(file);
        }
    } as unknown as FileSystemFileEntry;
}

function failingFileEntry(name: string): FileSystemFileEntry {
    return {
        name,
        isFile: true,
        isDirectory: false,
        file(_success: (value: File) => void, failure?: (error: DOMException) => void) {
            failure?.(new Error('file read failed') as unknown as DOMException);
        }
    } as unknown as FileSystemFileEntry;
}

function folderEntry(children: FileSystemEntry[]): FileSystemDirectoryEntry {
    let read = false;

    return {
        name: 'folder',
        isFile: false,
        isDirectory: true,
        createReader() {
            return {
                readEntries(success: (entries: FileSystemEntry[]) => void) {
                    if (read) {
                        success([]);
                        return;
                    }

                    read = true;
                    success(children);
                }
            };
        }
    } as unknown as FileSystemDirectoryEntry;
}

function transfer(entry: FileSystemEntry, released: () => boolean): DataTransfer {
    return {
        types: ['Files'],
        files: [],
        get items() {
            if (released()) return [];

            return [{ kind: 'file', webkitGetAsEntry: () => entry }];
        }
    } as unknown as DataTransfer;
}

function drop(zone: HTMLElement, data: DataTransfer): DragEvent {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: data });
    zone.dispatchEvent(event);

    return event;
}

test('a folder drop keeps the event data through the async traversal', async () => {
    const nested = new File(['nested'], 'nested.txt', { type: 'text/plain' });
    let released = false;
    const entry = folderEntry([fileEntry('nested.txt', nested, true)]);
    const onupload = vi.fn();
    render(FileDrop, { props: { disabled: false, onupload, children: children() } });
    const zone = screen.getByTestId('drop-zone');
    const event = drop(
        zone,
        transfer(entry, () => released)
    );

    released = true;

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(onupload).toHaveBeenCalledTimes(1));
    expect(onupload.mock.calls[0][0]).toEqual([
        expect.objectContaining({ name: 'nested.txt', type: 'text/plain' })
    ]);
    expect(onupload.mock.calls[0][0][0].webkitRelativePath).toBe('folder/nested.txt');
});

test('disabling the drop zone cancels a traversal that is still running', async () => {
    let finish: (() => void) | undefined;
    const nested = new File(['nested'], 'nested.txt');
    const entry = {
        name: 'slow.txt',
        isFile: true,
        isDirectory: false,
        file(success: (file: File) => void) {
            finish = () => success(nested);
        }
    } as unknown as FileSystemFileEntry;
    const onupload = vi.fn();
    const view = render(FileDrop, {
        props: { disabled: false, onupload, children: children() }
    });
    const zone = screen.getByTestId('drop-zone');

    drop(
        zone,
        transfer(entry, () => false)
    );
    await view.rerender({ disabled: true });
    finish?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onupload).not.toHaveBeenCalled();
});

test('a filesystem read failure shows an alert instead of rejecting', async () => {
    const onupload = vi.fn();
    render(FileDrop, { props: { disabled: false, onupload, children: children() } });
    const zone = screen.getByTestId('drop-zone');

    drop(
        zone,
        transfer(failingFileEntry('broken.txt'), () => false)
    );

    await vi.waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe(
            'Could not read the dropped files. Try again.'
        )
    );
    expect(onupload).not.toHaveBeenCalled();
});
