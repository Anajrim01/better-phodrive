import { expect, test } from 'vitest';
import { gridColumnCount, gridRowCount, listGaps, listSpacers } from '#lib/file-window';

test('grid columns match the auto-fill minimum and gap', () => {
    expect(gridColumnCount(0)).toBe(1);
    expect(gridColumnCount(1)).toBe(1);
    expect(gridColumnCount(219)).toBe(1);
    expect(gridColumnCount(220)).toBe(1);
    expect(gridColumnCount(455)).toBe(1);
    expect(gridColumnCount(456)).toBe(2);
    expect(gridColumnCount(500)).toBe(2);
    expect(gridColumnCount(1232)).toBe(5);
    expect(gridColumnCount(2000)).toBe(8);
});

test('grid rows cover every item with the last row partial', () => {
    expect(gridRowCount(0, 5)).toBe(0);
    expect(gridRowCount(5, 5)).toBe(1);
    expect(gridRowCount(6, 5)).toBe(2);
    expect(gridRowCount(2094, 5)).toBe(419);
    expect(gridRowCount(10, 0)).toBe(0);
});

test('spacers fill the space before and after the rendered rows', () => {
    const rows = [
        { key: 2, index: 2, start: 120, end: 168, size: 48, lane: 0 },
        { key: 3, index: 3, start: 168, end: 216, size: 48, lane: 0 }
    ];

    expect(listSpacers(rows, 1000, 100)).toEqual({ top: 20, bottom: 884 });
    expect(listSpacers([], 1000, 100)).toEqual({ top: 0, bottom: 1000 });
    expect(listSpacers(rows, 100, 0)).toEqual({ top: 120, bottom: 0 });
});

test('gaps cover rows skipped by a pinned drag source', () => {
    const rows = [
        { key: 0, index: 0, start: 0, end: 48, size: 48, lane: 0 },
        { key: 400, index: 400, start: 19200, end: 19248, size: 48, lane: 0 },
        { key: 401, index: 401, start: 19248, end: 19296, size: 48, lane: 0 }
    ];

    expect(listGaps(rows)).toEqual([0, 19152, 0]);
    expect(listGaps([])).toEqual([]);
});
