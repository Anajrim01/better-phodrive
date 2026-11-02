import { describe, expect, it } from 'vitest';
import { decodeManifest, encodeManifest, type Manifest } from '../src/manifest';

const ALBUM =
    'https://photos.google.com/share/AF1QipTestAlbum0000000000000000000000000000000000000000000?key=testCapabilityKey0000000000000000000000000000';
const FILE_ID = 'a'.repeat(64);

const manifest: Manifest = {
    v: 1,
    album: ALBUM,
    files: [{ id: FILE_ID, chunks: 3, name: 'notes.txt' }]
};

describe('manifest', () => {
    it('round trips a manifest', () => {
        const encoded = encodeManifest(manifest).unwrap();
        const decoded = decodeManifest(encoded).unwrap();

        expect(decoded).toEqual(manifest);
    });

    it('accepts a fragment without the leading hash', () => {
        const encoded = encodeManifest(manifest).unwrap().slice(1);

        expect(decodeManifest(encoded).unwrap()).toEqual(manifest);
    });

    it('rejects a missing fragment', () => {
        expect(decodeManifest('').unwrapErr().code).toBe('manifest_missing');
    });

    it('rejects non canonical album URLs', () => {
        const short = encodeManifest({
            ...manifest,
            album: 'https://photos.app.goo.gl/abc123'
        });
        expect(short.unwrapErr().code).toBe('manifest_invalid');

        const http = encodeManifest({
            ...manifest,
            album: ALBUM.replace('https://', 'http://')
        });
        expect(http.unwrapErr().code).toBe('manifest_invalid');

        const extra = encodeManifest({
            ...manifest,
            album: `${ALBUM}&hl=en`
        });
        expect(extra.unwrapErr().code).toBe('manifest_invalid');
    });

    it('rejects duplicate file ids and bad chunk counts', () => {
        const duplicate = encodeManifest({
            ...manifest,
            files: [manifest.files[0], manifest.files[0]]
        });
        expect(duplicate.unwrapErr().code).toBe('manifest_invalid');

        const zero = encodeManifest({
            ...manifest,
            files: [{ ...manifest.files[0], chunks: 0 }]
        });
        expect(zero.unwrapErr().code).toBe('manifest_invalid');
    });

    it('rejects bad base64url and malformed JSON', () => {
        const malformed = btoa('not json')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        expect(decodeManifest('#share=***').unwrapErr().code).toBe('manifest_invalid');
        expect(decodeManifest('#share=eyJ2IjoxfQ').unwrapErr().code).toBe('manifest_invalid');
        expect(decodeManifest(`#share=${malformed}`).unwrapErr().code).toBe('manifest_invalid');
        expect(decodeManifest('#share=eyJ2IjoxfQ==').unwrapErr().code).toBe('manifest_invalid');
    });

    it('rejects the wrong version and missing or extra fields', () => {
        expect(encodeManifest({ ...manifest, v: 2 }).unwrapErr().code).toBe('manifest_invalid');
        expect(encodeManifest({ v: 1, album: ALBUM }).unwrapErr().code).toBe('manifest_invalid');
        expect(encodeManifest({ v: 1, files: [] }).unwrapErr().code).toBe('manifest_invalid');
        expect(encodeManifest({ ...manifest, extra: true }).unwrapErr().code).toBe(
            'manifest_invalid'
        );
        expect(
            encodeManifest({
                ...manifest,
                files: [{ ...manifest.files[0], extra: true }]
            }).unwrapErr().code
        ).toBe('manifest_invalid');
    });

    it('rejects an oversized fragment', () => {
        expect(decodeManifest(`#share=${'a'.repeat(8_193)}`).unwrapErr().code).toBe(
            'manifest_invalid'
        );
    });
});
