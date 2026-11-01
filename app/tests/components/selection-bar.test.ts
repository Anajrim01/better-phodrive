// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import SelectionBar from '#components/SelectionBar.svelte';

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
});

type BarProps = ComponentProps<typeof SelectionBar>;

function props(overrides: Partial<BarProps> = {}): BarProps {
    return {
        count: 3,
        trash: false,
        disabled: false,
        running: null,
        ondownload: vi.fn(),
        onmove: vi.fn(),
        ondelete: vi.fn(),
        onrestore: vi.fn(),
        ondeleteforever: vi.fn(),
        ondetails: vi.fn(),
        onclear: vi.fn(),
        ...overrides
    };
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('the floating bar names the count and offers the main list bulk actions', () => {
    render(SelectionBar, { props: props() });

    expect(screen.getByRole('toolbar', { name: 'Selected files' })).toBeTruthy();
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download selected files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move selected files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete selected files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Details of selected files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /rename/i })).toBeNull();
});

test('Trash swaps in restore and delete forever without a bulk rename', () => {
    render(SelectionBar, { props: props({ trash: true }) });

    expect(screen.getByRole('button', { name: 'Restore selected files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete selected files forever' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Details of selected files' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download selected files' })).toBeNull();
    expect(screen.queryByRole('button', { name: /rename/i })).toBeNull();
});

test('bar actions call their bulk handlers and reflect a running action', async () => {
    const callbacks = props({ running: FileActionKind.Delete });
    render(SelectionBar, { props: callbacks });

    await fireEvent.click(screen.getByRole('button', { name: 'Download selected files' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Move selected files' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Details of selected files' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(callbacks.ondownload).toHaveBeenCalledTimes(1);
    expect(callbacks.onmove).toHaveBeenCalledTimes(1);
    expect(callbacks.ondetails).toHaveBeenCalledTimes(1);
    expect(callbacks.onclear).toHaveBeenCalledTimes(1);
    expect(
        screen.getByRole('button', { name: 'Delete selected files' }).hasAttribute('aria-busy')
    ).toBe(true);
});

test('every action keeps an accessible name when the mobile layout hides its label', () => {
    const view = render(SelectionBar, { props: props() });
    const labels = [...view.container.querySelectorAll('.action-label')];

    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label.textContent?.trim()).not.toBe('');
    for (const button of screen.getAllByRole('button'))
        expect(button.getAttribute('aria-label') ?? button.getAttribute('title')).toBeTruthy();
});
