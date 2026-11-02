import { Err, Ok, type Result } from 'results-ts';
import { z } from 'zod';
import { viewerFailure, type ViewerFailure } from './errors';
import { MAX_MANIFEST_CHUNKS, MAX_MANIFEST_FILES, MAX_MANIFEST_FRAGMENT_LENGTH } from './limits';

const FILE_ID = /^[0-9a-f]{64}$/;
const ALBUM_PATH = /^\/share\/[A-Za-z0-9_-]{10,200}$/;
const CAPABILITY_KEY = /^[A-Za-z0-9_-]{8,500}$/;

const ManifestFileSchema = z
    .object({
        id: z.string().regex(FILE_ID),
        chunks: z.number().int().min(1).max(MAX_MANIFEST_CHUNKS),
        name: z.string().min(1).max(255).optional()
    })
    .strict();

const ManifestSchema = z
    .object({
        v: z.literal(1),
        album: z.string().max(2_048),
        files: z.array(ManifestFileSchema).min(1).max(MAX_MANIFEST_FILES)
    })
    .strict()
    .refine((manifest) => isCanonicalAlbum(manifest.album))
    .refine(
        (manifest) => new Set(manifest.files.map((file) => file.id)).size === manifest.files.length
    );

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestFile = Manifest['files'][number];

function isCanonicalAlbum(value: string): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }

    if (
        url.protocol !== 'https:' ||
        url.hostname !== 'photos.google.com' ||
        url.port !== '' ||
        url.username !== '' ||
        url.password !== '' ||
        url.hash !== '' ||
        !ALBUM_PATH.test(url.pathname)
    )
        return false;

    const keys = url.searchParams.getAll('key');
    const names = [...url.searchParams.keys()];

    return (
        names.length === 1 &&
        names[0] === 'key' &&
        keys.length === 1 &&
        CAPABILITY_KEY.test(keys[0])
    );
}

function toBase64Url(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Result<string, ViewerFailure> {
    if (!/^[A-Za-z0-9_-]+$/.test(value))
        return Err(viewerFailure('manifest_invalid', 'Share link is not valid.'));

    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));

    try {
        const binary = atob(padded + padding);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

        return Ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return Err(viewerFailure('manifest_invalid', 'Share link is not valid.'));
    }
}

export function encodeManifest(manifest: unknown): Result<string, ViewerFailure> {
    const parsed = ManifestSchema.safeParse(manifest);
    if (!parsed.success) return Err(viewerFailure('manifest_invalid', 'Share link is not valid.'));

    return Ok(`#share=${toBase64Url(JSON.stringify(parsed.data))}`);
}

export function decodeManifest(hash: string): Result<Manifest, ViewerFailure> {
    if (!hash) return Err(viewerFailure('manifest_missing', 'This page needs a share link.'));

    const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!fragment.startsWith('share='))
        return Err(viewerFailure('manifest_invalid', 'Share link is not valid.'));

    const encoded = fragment.slice('share='.length);
    if (!encoded || encoded.length > MAX_MANIFEST_FRAGMENT_LENGTH)
        return Err(viewerFailure('manifest_invalid', 'Share link is not valid.'));

    return fromBase64Url(encoded).andThen((text) => {
        let value: unknown;

        try {
            value = JSON.parse(text);
        } catch {
            return Err(viewerFailure('manifest_invalid', 'Share link is not valid.'));
        }

        const parsed = ManifestSchema.safeParse(value);
        if (!parsed.success)
            return Err(viewerFailure('manifest_invalid', 'Share link is not valid.'));

        return Ok(parsed.data);
    });
}
