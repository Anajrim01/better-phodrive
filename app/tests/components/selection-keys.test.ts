// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import SelectionKeys from '#components/SelectionKeys.svelte';

beforeEach(() => cleanup());
afterEach(() => cleanup());

function mount(overrides: Partial<{ canSelectAll: boolean; canClear: boolean }> = {}) {
    const onselectall = vi.fn();
    const onclear = vi.fn();
    render(SelectionKeys, {
        props: { canSelectAll: true, canClear: true, onselectall, onclear, ...overrides }
    });

    return { onselectall, onclear };
}

test('Ctrl+A and Cmd+A select all visible files', () => {
    const { onselectall } = mount();

    const control = new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        cancelable: true,
        bubbles: true
    });
    window.dispatchEvent(control);
    const meta = new KeyboardEvent('keydown', {
        key: 'A',
        metaKey: true,
        cancelable: true,
        bubbles: true
    });
    window.dispatchEvent(meta);

    expect(onselectall).toHaveBeenCalledTimes(2);
    expect(control.defaultPrevented).toBe(true);
    expect(meta.defaultPrevented).toBe(true);
});

test('Escape clears a non-empty selection', () => {
    const { onclear } = mount();

    const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
        bubbles: true
    });
    window.dispatchEvent(escape);

    expect(onclear).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBe(true);
});

test('a focused checkbox does not block the selection shortcuts', () => {
    const { onselectall, onclear } = mount();
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(checkbox);
    checkbox.focus();

    checkbox.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    checkbox.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })
    );

    expect(onclear).toHaveBeenCalledTimes(1);
    expect(onselectall).toHaveBeenCalledTimes(1);
    checkbox.remove();
});

test('keys inside a text field stay with the field', () => {
    const { onselectall, onclear } = mount();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    input.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'a',
            ctrlKey: true,
            bubbles: true,
            cancelable: true
        })
    );
    input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );

    expect(onselectall).not.toHaveBeenCalled();
    expect(onclear).not.toHaveBeenCalled();
    input.remove();
});

test('disabled shortcuts do nothing', () => {
    const { onselectall, onclear } = mount({ canSelectAll: false, canClear: false });

    window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })
    );
    window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );

    expect(onselectall).not.toHaveBeenCalled();
    expect(onclear).not.toHaveBeenCalled();
});
