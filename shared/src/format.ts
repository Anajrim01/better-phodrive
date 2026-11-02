const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '0 B';

    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < UNITS.length - 1) {
        size /= 1024;
        unit++;
    }

    const digits = unit === 0 || size >= 10 ? 0 : 1;

    return `${size.toFixed(digits)} ${UNITS[unit]}`;
}

export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
    return `${value} ${value === 1 ? singular : plural}`;
}

export function shortHash(value: string): string {
    return `${value.slice(0, 12)}...${value.slice(-8)}`;
}
