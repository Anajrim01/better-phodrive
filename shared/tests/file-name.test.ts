import { describe, expect, it } from 'vitest';
import { sanitizeFileName, sanitizeFolderPath } from '../src/file-name';

describe('file name sanitizer', () => {
    it('removes control, bidi, and path characters', () => {
        expect(sanitizeFileName('..\\secret/\u202Ename\u0000.txt')).toBe('-secret-name.txt');
        expect(sanitizeFileName('a\u001fb\u007fc\u009fd')).toBe('abcd');
        expect(sanitizeFileName('a<>:"|?*b')).toBe('a-------b');
        expect(sanitizeFileName('a\u200Bb\u2060c\uFEFFd')).toBe('abcd');
    });

    it('trims dots and spaces from both ends', () => {
        expect(sanitizeFileName('  ..report..  ')).toBe('report');
    });

    it('caps long names and keeps the extension', () => {
        const name = sanitizeFileName(`${'a'.repeat(300)}.txt`);

        expect(name.length).toBeLessThanOrEqual(255);
        expect(name.endsWith('.txt')).toBe(true);
    });

    it('avoids Windows reserved names', () => {
        expect(sanitizeFileName('CON.txt')).toBe('CON_.txt');
        expect(sanitizeFileName('nul')).toBe('nul_');
    });

    it('caps multibyte names by UTF-8 bytes', () => {
        const name = sanitizeFileName(`${'漢'.repeat(200)}.txt`);

        expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
        expect(name.endsWith('.txt')).toBe(true);
    });

    it('sanitizes folder paths without dropping separators', () => {
        expect(sanitizeFolderPath('oct\u202Eober/notes')).toBe('october/notes');
    });

    it('falls back when nothing remains', () => {
        expect(sanitizeFileName('   ...   ')).toBe('phodrive-file');
        expect(sanitizeFileName('\u202E\u0000')).toBe('phodrive-file');
    });
});
