import { FileActionKind, FileRequestSchema } from '@phodrive/core/models';
import { downloadFile, deleteFile } from '@phodrive/core/server/files';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, FileRequestSchema, 'Invalid request')
        .andThenAsync((input) =>
            input.action === FileActionKind.Download
                ? downloadFile(input, request.signal)
                : deleteFile(input).map(jsonResponse)
        )
        .match({ Ok: (response) => response, Err: errorResponse });
