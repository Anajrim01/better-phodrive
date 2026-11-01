// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { isSelectionBackground } from '#browser/drive/selection-background';

function element(tag: string, parent?: Element, attributes: Record<string, string> = {}): Element {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    parent?.append(node);

    return node;
}

describe('isSelectionBackground', () => {
    test('plain page surfaces clear the selection', () => {
        expect(isSelectionBackground(element('main'))).toBe(true);
        expect(isSelectionBackground(element('h1'))).toBe(true);
        expect(isSelectionBackground(null)).toBe(false);
    });

    test('controls, rows, tiles, menus and tooltips keep the selection', () => {
        for (const tag of ['button', 'a', 'input', 'select', 'textarea', 'label', 'tr', 'li']) {
            expect(isSelectionBackground(element(tag))).toBe(false);
        }

        expect(isSelectionBackground(element('div', undefined, { 'data-file-key': 'a' }))).toBe(
            false
        );
        expect(isSelectionBackground(element('div', undefined, { role: 'menu' }))).toBe(false);
        expect(isSelectionBackground(element('div', undefined, { role: 'tooltip' }))).toBe(false);
        expect(isSelectionBackground(element('div', undefined, { class: 'marquee-surface' }))).toBe(
            false
        );
        expect(isSelectionBackground(element('div', undefined, { class: 'selection-bar' }))).toBe(
            false
        );
        expect(isSelectionBackground(element('dialog'))).toBe(false);
    });

    test('a child of a control is not background', () => {
        const button = element('button');
        const icon = element('span', button);

        expect(isSelectionBackground(icon)).toBe(false);
    });
});
