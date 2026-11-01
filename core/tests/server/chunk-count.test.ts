import { expect, test } from 'vitest';
import { expectedChunkCount } from '@madkarmaa/phodrive-core/server/photos/library/probe';

const HASH = 'a'.repeat(64);

test('chunk file names declare their expected chunk count', () => {
    expect(expectedChunkCount(`file.bin.phodrive-${HASH}-0-of-3.bmp`)).toBe(3);
    expect(expectedChunkCount(`file.bin.phodrive-${HASH}-2-of-3.bmp`)).toBe(3);
});

test('chunk names without a valid count have no declared count', () => {
    expect(expectedChunkCount(`file.bin.phodrive-${HASH}-0.bmp`)).toBeUndefined();
    expect(expectedChunkCount(`file.bin.phodrive-${HASH}-3-of-3.bmp`)).toBeUndefined();
    expect(expectedChunkCount(`file.bin.phodrive-${HASH}-0-of-0.bmp`)).toBeUndefined();
    expect(expectedChunkCount('holiday.jpg')).toBeUndefined();
    expect(expectedChunkCount()).toBeUndefined();
});
