import { expect, test } from 'vitest';
import { selectionBarSpace, selectionBarVisible } from '#browser/drive/selection-view.svelte';

test('the bar space stays reserved while files are selected or a bulk action runs', () => {
    expect(selectionBarSpace(3, false)).toBe(true);
    expect(selectionBarSpace(0, true)).toBe(true);
    expect(selectionBarSpace(0, false)).toBe(false);
});

test('the bar stays visible at zero selected while a bulk action runs', () => {
    expect(selectionBarVisible(0, true, false)).toBe(true);
});

test('the bar stays hidden with no selection and no running action', () => {
    expect(selectionBarVisible(0, false, false)).toBe(false);
});

test('the bar follows the selection when idle', () => {
    expect(selectionBarVisible(3, false, false)).toBe(true);
});

test('an open overlay hides the bar even during a run', () => {
    expect(selectionBarVisible(0, true, true)).toBe(false);
    expect(selectionBarVisible(3, false, true)).toBe(false);
});
