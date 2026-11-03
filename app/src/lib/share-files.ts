import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import {
    MAX_SHARE_CHUNKS,
    MAX_SHARE_FILES,
    MAX_SHARE_NAME_LENGTH,
    SHARE_BASE_URL,
    ShareManifestSchema,
    ShareFileInputSchema,
    type ShareFileInput
} from '@madkarmaa/phodrive-core/share-models';
import { Err, Ok, type Result } from 'results-ts';

export type ShareFilesError = {
    readonly code:
        'NO_FILES' | 'INCOMPLETE_FILES' | 'INVALID_FILE' | 'TOO_MANY_FILES' | 'TOO_MANY_CHUNKS';
    readonly message: string;
};

function shareFileInput(file: FileGroup): ShareFileInput | null {
    if (!file.complete || file.trashed || file.chunks.length === 0) return null;

    const chunks = [...file.chunks].sort((first, second) => first.chunkIndex - second.chunkIndex);
    const contiguous = chunks.every((chunk, index) => chunk.chunkIndex === index);
    if (!contiguous) return null;

    const input = {
        id: file.fileId,
        name: file.name,
        chunks: chunks.map((chunk, index) => ({ index, mediaKey: chunk.mediaKey }))
    };
    const parsed = ShareFileInputSchema.safeParse(input);

    return parsed.success ? parsed.data : null;
}

export function shareFileInputs(
    files: readonly FileGroup[]
): Result<ShareFileInput[], ShareFilesError> {
    if (files.length === 0)
        return Err({ code: 'NO_FILES', message: 'Choose at least one file to share.' });

    if (files.length > MAX_SHARE_FILES)
        return Err({
            code: 'TOO_MANY_FILES',
            message: `A share can include up to ${MAX_SHARE_FILES} files.`
        });

    const inputs: ShareFileInput[] = [];
    for (const file of files) {
        const input = shareFileInput(file);
        if (input === null) {
            const incomplete = files.some((item) => !item.complete);

            return Err(
                incomplete
                    ? {
                          code: 'INCOMPLETE_FILES',
                          message:
                              'Share needs complete files. Remove incomplete files to continue.'
                      }
                    : {
                          code: 'INVALID_FILE',
                          message: 'One of these files cannot be shared. Refresh and try again.'
                      }
            );
        }

        inputs.push(input);
    }

    const chunks = inputs.reduce((total, file) => total + file.chunks.length, 0);
    if (chunks > MAX_SHARE_CHUNKS)
        return Err({
            code: 'TOO_MANY_CHUNKS',
            message: `A share can include up to ${MAX_SHARE_CHUNKS} chunks.`
        });

    return Ok(inputs);
}

export function defaultShareName(files: readonly { name: string }[]): string {
    if (files.length === 0) return 'Share';
    if (files.length > 1) return `${files.length} files`;

    const name = files[0]?.name ?? 'Share';
    const withoutExtension = name.replace(/\.[^.]+$/, '').trim();
    const candidate = withoutExtension || name.trim() || 'Share';

    return candidate.slice(0, MAX_SHARE_NAME_LENGTH);
}

export function shareNameError(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) return 'Enter a name for the share link.';
    if (trimmed.length > MAX_SHARE_NAME_LENGTH)
        return `Use ${MAX_SHARE_NAME_LENGTH} characters or fewer.`;

    return null;
}

export function shareFileCount(shareUrl: string): number | null {
    if (!shareUrl.startsWith(SHARE_BASE_URL)) return null;

    const encoded = shareUrl.slice(SHARE_BASE_URL.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;

    try {
        const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const parsed = ShareManifestSchema.safeParse(value);

        return parsed.success ? parsed.data.files.length : null;
    } catch {
        return null;
    }
}
