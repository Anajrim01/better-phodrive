import { expect, test } from 'vitest';
import { intersects, marqueeRect } from '#lib/marquee';

test('a dragged rectangle is normalized from any corner', () => {
    expect(marqueeRect(120, 80, 40, 20)).toEqual({
        left: 40,
        top: 20,
        right: 120,
        bottom: 80
    });
    expect(marqueeRect(10, 20, 40, 60)).toEqual({
        left: 10,
        top: 20,
        right: 40,
        bottom: 60
    });
});

test('rectangles intersect only when they overlap in both axes', () => {
    const rect = marqueeRect(10, 10, 100, 100);
    const target = { left: 20, top: 20, right: 80, bottom: 80 };

    expect(intersects(rect, target)).toBe(true);
    expect(intersects(rect, { left: 100, top: 20, right: 140, bottom: 80 })).toBe(false);
    expect(intersects(rect, { left: 20, top: 100, right: 80, bottom: 140 })).toBe(false);
    expect(intersects(rect, { left: 0, top: 0, right: 5, bottom: 5 })).toBe(false);
    expect(intersects(rect, { left: 50, top: 50, right: 60, bottom: 60 })).toBe(true);
});
