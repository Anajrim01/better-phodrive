// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ErrorFeedback from '#components/ErrorFeedback.svelte';

const LONG_MESSAGE = `Could not delete any files. ${'The server rejected this file. '.repeat(200)}`;

vi.hoisted(() => {
    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
        configurable: true,
        value: () => {}
    });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
        configurable: true,
        value: () => {}
    });
});

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('a long error keeps the snackbar height constrained and its label scrollable', () => {
    const { container } = render(ErrorFeedback, { props: { message: LONG_MESSAGE } });
    const snackbar = container.querySelector<HTMLElement>('.error-feedback');
    const label = snackbar?.querySelector<HTMLElement>('.np-snackbar-label');
    const labelContainer = snackbar?.querySelector<HTMLElement>('.np-snackbar-label-container');

    expect(snackbar).toBeTruthy();
    expect(label?.textContent).toBe(LONG_MESSAGE);
    expect(labelContainer).toBeTruthy();
    expect(snackbar?.style.maxHeight).toBe('40vh');
    expect(labelContainer?.classList.contains('np-snackbar-label-container')).toBe(true);
});
