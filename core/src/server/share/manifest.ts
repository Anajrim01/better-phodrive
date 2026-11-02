import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type Result } from 'results-ts';
import {
    MAX_SHARE_URL_LENGTH,
    SHARE_BASE_URL,
    ShareManifestSchema,
    type ShareManifest,
    type ShareManifestFile
} from '../../share-models';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function buildShareUrl(manifest: ShareManifest): Result<string, ServerError> {
    const parsed = ShareManifestSchema.safeParse(manifest);
    if (!parsed.success) return Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);

    const encoded = Buffer.from(JSON.stringify(parsed.data), 'utf8').toString('base64url');
    const shareUrl = `${SHARE_BASE_URL}${encoded}`;
    if (shareUrl.length > MAX_SHARE_URL_LENGTH) return Err(SERVER_ERRORS.SHARE_URL_TOO_LONG);

    return Ok(shareUrl);
}

export function decodeShareUrl(shareUrl: string): Result<ShareManifest, ServerError> {
    if (!shareUrl.startsWith(SHARE_BASE_URL)) return Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);

    const encoded = shareUrl.slice(SHARE_BASE_URL.length);
    if (!BASE64URL_PATTERN.test(encoded)) return Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);

    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
        return Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);
    }

    const parsed = ShareManifestSchema.safeParse(value);

    return parsed.success ? Ok(parsed.data) : Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);
}

export function manifestFile(file: {
    id: string;
    chunks: readonly unknown[];
    name?: string;
}): ShareManifestFile {
    return {
        id: file.id,
        chunks: file.chunks.length,
        ...(file.name === undefined ? {} : { name: file.name })
    };
}
