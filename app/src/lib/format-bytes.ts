const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const BASE = 1000;

export function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0 B';

    let size = value;
    let unit = 0;
    while (size >= BASE && unit < UNITS.length - 1) {
        size /= BASE;
        unit++;
    }

    if (unit === 0) return `${Math.round(size)} B`;

    return `${size.toFixed(1)} ${UNITS[unit]}`;
}
