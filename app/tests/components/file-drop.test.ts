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

test('a folder drop keeps the event data through the async traversal', async () => {
    const nested = new File(['nested'], 'nested.txt', { type: 'text/plain' });
    const entry = {
        name: 'folder',
        isFile: false,
        isDirectory: true,
        createReader() {
            let read = false;

            return {
                readEntries(success: (entries: FileSystemEntry[]) => void) {
                    if (read) {
                        success([]);
                        return;
                    }

                    read = true;
                    success([
                        {
                            name: 'nested.txt',
                            isFile: true,
                            isDirectory: false,
                            file(callback: (file: File) => void) {
                                setTimeout(() => callback(nested), 0);
                            }
                        } as unknown as FileSystemFileEntry
                    ]);
                }
            };
        }
    } as unknown as FileSystemDirectoryEntry;
    let reads = 0;
    const transfer = {
        types: ['Files'],
        files: [],
        get items() {
            reads += 1;

            if (reads > 1) return [];

            return [{ kind: 'file', webkitGetAsEntry: () => entry }];
        }
    } as unknown as DataTransfer;
    const onupload = vi.fn();
    const children = createRawSnippet(() => ({
        render: () => '<div data-testid="drop-zone">Files</div>'
    }));
    render(FileDrop, { props: { disabled: false, onupload, children } });
    const zone = screen.getByTestId('drop-zone');
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: transfer });

    zone.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(onupload).toHaveBeenCalledTimes(1));
    expect(onupload.mock.calls[0][0]).toEqual([
        expect.objectContaining({ name: 'nested.txt', type: 'text/plain' })
    ]);
    expect(onupload.mock.calls[0][0][0].webkitRelativePath).toBe('folder/nested.txt');
});
