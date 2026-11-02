// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ErrorFeedback from '#components/ErrorFeedback.svelte';

const LONG_MESSAGE = `Could not delete any files. ${'The server rejected this file. '.repeat(200)}`;
const ERROR_FEEDBACK_SOURCE = readFileSync('src/lib/components/ErrorFeedback.svelte', 'utf8');

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

test('the scroll rules keep the long label inside the capped snackbar', () => {
    const styles = ERROR_FEEDBACK_SOURCE.slice(ERROR_FEEDBACK_SOURCE.indexOf('<style>'));

    expect(styles).toMatch(/\.np-snackbar-inner[^{]*\{[^}]*max-height:\s*inherit/s);
    expect(styles).toMatch(/\.np-snackbar-label-container[^{]*\{[^}]*max-height:\s*inherit/s);
    expect(styles).toMatch(/overflow-y:\s*(auto|scroll)/);
});
