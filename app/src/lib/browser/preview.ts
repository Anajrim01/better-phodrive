import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import {
    PreviewMode,
    PreviewTextResponseSchema,
    PreviewUnavailableResponseSchema as UnavailableSchema,
    type PreviewUnavailableReason
} from '@madkarmaa/phodrive-core/models';
import { request } from '@madkarmaa/phodrive-core/browser/api';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';

const PREVIEW_API_URL = '/api/files/preview';

export type PreviewPayload =
    | { kind: 'image'; blob: Blob; contentType: string }
    | { kind: 'text'; text: string; truncated: boolean }
    | { kind: 'unavailable'; reason: PreviewUnavailableReason };

function previewRequest(
    item: FileGroup,
    token: string,
    mode: PreviewMode,
    signal: AbortSignal
): RequestInit {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            mode,
            email: item.email,
            token,
            name: item.name,
            fileHash: item.fileHash,
            fileId: item.fileId,
            chunks: item.chunks
        }),
        signal
    };
}

async function readPayload(
    response: Response,
    mode: PreviewMode
): Promise<Result<PreviewPayload, ApplicationError>> {
    if (mode === PreviewMode.Image) {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.startsWith('image/')) {
            try {
                const blob = await response.blob();

                return Ok({ kind: 'image', blob, contentType });
            } catch {
                return Err({
                    code: 'REQUEST_FAILED',
                    message: 'Preview was interrupted. Try again.'
                } as const);
            }
        }
    }

    let data: unknown;
    try {
        data = await response.json();
    } catch {
        return Err({ code: 'REQUEST_FAILED', message: 'Preview failed' } as const);
    }

    const unavailable = UnavailableSchema.safeParse(data);
    if (unavailable.success) return Ok({ kind: 'unavailable', reason: unavailable.data.reason });

    const text = PreviewTextResponseSchema.safeParse(data);
    if (text.success) return Ok({ kind: 'text', ...text.data });

    return Err({ code: 'REQUEST_FAILED', message: 'Preview failed' } as const);
}

export function fetchFilePreview(
    item: FileGroup,
    token: string,
    mode: PreviewMode,
    signal: AbortSignal
): AsyncResult<PreviewPayload, ApplicationError> {
    return request(
        PREVIEW_API_URL,
        previewRequest(item, token, mode, signal),
        'Preview failed'
    ).andThenAsync(async (response) => readPayload(response, mode));
}
