import { expect, test } from 'vitest';
import { clampMenuPosition } from '#lib/menu-position';

test('a menu near the right and bottom edges stays inside the viewport', () => {
    const placement = clampMenuPosition({
        x: 900,
        y: 700,
        width: 240,
        height: 260,
        viewportWidth: 1000,
        viewportHeight: 800
    });

    expect(placement.left).toBe(752);
    expect(placement.top).toBe(440);
    expect(placement.maxHeight).toBe(784);
});

test('a menu below the anchor opens above it when there is no room', () => {
    const placement = clampMenuPosition({
        x: 100,
        y: 620,
        width: 240,
        height: 200,
        viewportWidth: 1000,
        viewportHeight: 800
    });

    expect(placement.left).toBe(100);
    expect(placement.top).toBe(420);
});

test('a menu taller than the viewport receives a viewport-sized max height', () => {
    const placement = clampMenuPosition({
        x: 10,
        y: 10,
        width: 200,
        height: 2_000,
        viewportWidth: 800,
        viewportHeight: 600,
        margin: 12
    });

    expect(placement.top).toBe(12);
    expect(placement.maxHeight).toBe(576);
});

test('a small viewport still produces a usable placement', () => {
    const placement = clampMenuPosition({
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        viewportWidth: 320,
        viewportHeight: 240
    });

    expect(placement.left).toBe(8);
    expect(placement.top).toBe(8);
    expect(placement.maxHeight).toBe(224);
});
