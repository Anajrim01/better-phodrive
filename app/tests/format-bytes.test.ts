import { expect, test } from 'vitest';
import { formatBytes } from '#lib/format-bytes';

test('sizes use one casing and one decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(864_000)).toBe('864.0 KB');
    expect(formatBytes(3_460_000)).toBe('3.5 MB');
    expect(formatBytes(1_730_000)).toBe('1.7 MB');
    expect(formatBytes(1_820_000_000)).toBe('1.8 GB');
});
