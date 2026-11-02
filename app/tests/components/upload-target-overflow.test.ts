// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Group } from '@madkarmaa/phodrive-core/models';
import UploadTarget from '#components/UploadTarget.svelte';

const LONG_EMAIL = 'a.very.long.account.name.that.should.not.widen.the.selector@example.com';
const LONG_GROUP =
    'A very long household group name that should truncate instead of widening the control';
const groups: Group[] = [
    {
        id: 'family',
        name: LONG_GROUP,
        accounts: [LONG_EMAIL, 'second@example.com']
    }
];

function renderTarget(value: string) {
    return render(UploadTarget, {
        props: {
            groups,
            value,
            currentEmail: LONG_EMAIL,
            onchange: vi.fn()
        }
    });
}

function constrainedControl(container: HTMLElement): HTMLElement {
    const control = container.querySelector('.np-text-field');
    if (!(control instanceof HTMLElement)) {
        throw new Error('Expected the upload target control.');
    }

    const style = getComputedStyle(control);
    expect(control.classList.contains('upload-target')).toBe(true);
    expect(control.parentElement?.classList.contains('min-w-0')).toBe(true);
    expect(style.display).toBe('flex');
    expect(style.width).toBe('100%');
    expect(style.minWidth).toBe('0px');
    expect(style.getPropertyValue('--np-select-min-width')).toBe('0');

    return control;
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('the upload target control is constrained for a long current account email', () => {
    const { container } = renderTarget('');
    const control = constrainedControl(container);

    expect(control.querySelector('.input')?.textContent).toBe(`Current account (${LONG_EMAIL})`);
    expect(screen.getAllByText(LONG_GROUP).length).toBeGreaterThan(0);
});

test('the upload target control is constrained for a long group name', () => {
    const { container } = renderTarget('family');
    const control = constrainedControl(container);

    expect(control.querySelector('.input')?.textContent).toBe(LONG_GROUP);
    expect(screen.getAllByText(`Current account (${LONG_EMAIL})`).length).toBeGreaterThan(0);
});

test('the current account uses a non-empty sentinel and maps back to the empty value', async () => {
    const onchange = vi.fn();
    const { container } = render(UploadTarget, {
        props: {
            groups,
            value: '',
            currentEmail: LONG_EMAIL,
            onchange
        }
    });
    const select = container.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) throw new Error('Expected the select element.');

    const current = select.selectedOptions.item(0);
    if (!current) throw new Error('Expected the current account option.');

    expect(current.value).not.toBe('');
    expect(select.value).toBe(current.value);
    expect(
        container.querySelector('.field')?.matches(':has(select option:checked:not([value=""]))')
    ).toBe(true);

    await fireEvent.change(select, { target: { value: current.value } });
    expect(onchange).toHaveBeenLastCalledWith('');
});

test('a group selection keeps its external id', async () => {
    const onchange = vi.fn();
    const { container } = render(UploadTarget, {
        props: {
            groups,
            value: 'family',
            currentEmail: LONG_EMAIL,
            onchange
        }
    });
    const select = container.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) throw new Error('Expected the select element.');

    expect(select.value).toBe('family');

    await fireEvent.change(select, { target: { value: 'family' } });
    expect(onchange).toHaveBeenLastCalledWith('family');
});
