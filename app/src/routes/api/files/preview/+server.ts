import { FilePreviewRequestSchema } from '@madkarmaa/phodrive-core/models';
import { previewFile, type PreviewResult } from '@madkarmaa/phodrive-core/server/preview';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

function previewResponse(preview: PreviewResult): Response {
    if (preview.kind === 'image') {
        const body = new Uint8Array(preview.bytes).buffer;

        return new Response(body, {
            headers: {
                'cache-control': 'no-store',
                'content-type': preview.contentType,
                'x-content-type-options': 'nosniff'
            }
        });
    }

    if (preview.kind === 'text')
        return jsonResponse({ text: preview.text, truncated: preview.truncated });

    return jsonResponse({ reason: preview.reason });
}

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, FilePreviewRequestSchema, 'Invalid preview request')
        .andThenAsync((input) => previewFile(input, request.signal, 'manual'))
        .match({ Ok: previewResponse, Err: errorResponse });
