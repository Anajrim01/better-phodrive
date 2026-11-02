import { describe, expect, it } from 'vitest';
import { isSplitChunk, parseChunkPrefix } from '../src/bmp';
import { encodeChunk, hashBytes } from './helpers/bmp';

const fileHash = hashBytes('file');
const fileId = hashBytes('id');

describe('BMP split parser', () => {
    it('parses an uncompressed chunk with a name and folder', () => {
        const bytes = encodeChunk({
            payload: new Uint8Array([1, 2, 3, 4]),
            fileHash,
            fileId,
            index: 0,
            flags: 1,
            name: 'notes.txt',
            folder: 'docs'
        });
        const header = parseChunkPrefix(bytes).unwrap();

        expect(isSplitChunk(bytes)).toBe(true);
        expect(header.fileHash).toBe(fileHash);
        expect(header.fileId).toBe(fileId);
        expect(header.chunkIndex).toBe(0);
        expect(header.flags).toBe(1);
        expect(header.payloadSize).toBe(4);
        expect(header.fileName).toBe('notes.txt');
        expect(header.folder).toBe('docs');
        expect(header.paddingSize).toBeGreaterThan(0);
        expect(header.last).toBe(true);
        expect(header.compressed).toBe(false);
    });

    it('parses a compressed chunk', () => {
        const bytes = encodeChunk({
            payload: new Uint8Array([5, 6, 7]),
            fileHash,
            fileId,
            index: 1,
            flags: 2,
            originalSize: 12
        });
        const header = parseChunkPrefix(bytes).unwrap();

        expect(header.compressed).toBe(true);
        expect(header.originalSize).toBe(12);
        expect(header.last).toBe(false);
        expect(header.fileName).toBeUndefined();
    });

    it('rejects a non split bitmap', () => {
        const bytes = encodeChunk({
            payload: new Uint8Array([1]),
            fileHash,
            fileId,
            index: 0,
            flags: 1,
            name: 'a.txt'
        });
        bytes[54] = 0;

        expect(isSplitChunk(bytes)).toBe(false);
        expect(parseChunkPrefix(bytes).unwrapErr().code).toBe('chunk_invalid');
    });

    it('rejects a wrong total size', () => {
        const bytes = encodeChunk({
            payload: new Uint8Array([1]),
            fileHash,
            fileId,
            index: 0,
            flags: 1,
            name: 'a.txt'
        });
        new DataView(bytes.buffer).setUint32(2, bytes.length + 4, true);

        expect(parseChunkPrefix(bytes).unwrapErr().code).toBe('chunk_invalid');
    });

    it('rejects unsupported flags', () => {
        const bytes = encodeChunk({
            payload: new Uint8Array([1]),
            fileHash,
            fileId,
            index: 0,
            flags: 4,
            name: 'a.txt'
        });

        expect(parseChunkPrefix(bytes).unwrapErr().code).toBe('chunk_invalid');
    });

    it('rejects a first chunk without a name', () => {
        const bytes = encodeChunk({
            payload: new Uint8Array([1]),
            fileHash,
            fileId,
            index: 0,
            flags: 1,
            name: ''
        });

        expect(parseChunkPrefix(bytes).unwrapErr().code).toBe('chunk_invalid');
    });

    it('rejects a truncated header', () => {
        const bytes = encodeChunk({
            payload: new Uint8Array([1]),
            fileHash,
            fileId,
            index: 0,
            flags: 1,
            name: 'a.txt'
        });

        expect(parseChunkPrefix(bytes.subarray(0, 80)).unwrapErr().code).toBe('chunk_invalid');
    });

    it('rejects a compressed chunk whose original size is smaller than the payload', () => {
        const bytes = encodeChunk({
            payload: new Uint8Array(100),
            fileHash,
            fileId,
            index: 0,
            flags: 3,
            originalSize: 10,
            name: 'a.txt'
        });

        expect(parseChunkPrefix(bytes).unwrapErr().code).toBe('chunk_invalid');
    });
});
