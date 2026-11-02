import { describe, expect, it } from 'vitest';
import { parseMediaUrl, parseRange } from '../functions/_lib/media-url';

const TOKEN = 'token-abcdefghijklmnopqrstuvwxyz';

describe('media URL parser', () => {
    it('uses origin and pathname without a trailing query', () => {
        const parsed = parseMediaUrl(`https://lh3.googleusercontent.com/pw/${TOKEN}?`).unwrap();

        expect(parsed.url).toBe(`https://lh3.googleusercontent.com/pw/${TOKEN}`);
        expect(parsed.downloadUrl).toBe(`https://lh3.googleusercontent.com/pw/${TOKEN}=d`);
    });

    it('requires a range', () => {
        expect(parseRange(undefined).unwrapErr().code).toBe('RANGE_REQUIRED');
    });

    it('rejects another host', () => {
        expect(parseMediaUrl(`https://example.com/pw/${TOKEN}`).unwrapErr().code).toBe(
            'INVALID_BYTES_URL'
        );
    });
});
