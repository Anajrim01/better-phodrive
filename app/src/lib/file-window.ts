import type { VirtualItem } from '@tanstack/virtual-core';

export const GRID_COLUMN_MIN_WIDTH = 220;
export const GRID_GAP = 16;

export function gridColumnCount(width: number): number {
    if (width <= 0) return 1;

    return Math.max(1, Math.floor((width + GRID_GAP) / (GRID_COLUMN_MIN_WIDTH + GRID_GAP)));
}

export function gridRowCount(itemCount: number, columns: number): number {
    if (itemCount <= 0 || columns <= 0) return 0;

    return Math.ceil(itemCount / columns);
}

export function listGaps(rows: readonly VirtualItem[]): number[] {
    return rows.map((row, index) => {
        if (index === 0) return 0;

        return Math.max(row.start - rows[index - 1]!.end, 0);
    });
}

export function listSpacers(
    rows: readonly VirtualItem[],
    totalSize: number,
    scrollMargin: number
): { top: number; bottom: number } {
    const first = rows[0];
    const last = rows.at(-1);
    if (!first || !last) return { top: 0, bottom: Math.max(totalSize, 0) };

    return {
        top: Math.max(first.start - scrollMargin, 0),
        bottom: Math.max(totalSize - (last.end - scrollMargin), 0)
    };
}
