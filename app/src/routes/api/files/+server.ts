import { FileActionKind, FileRequestSchema } from '@madkarmaa/phodrive-core/models';
import { downloadFile, deleteFile } from '@madkarmaa/phodrive-core/server/files';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, FileRequestSchema, 'Invalid request')
        .andThenAsync((input) =>
            input.action === FileActionKind.Download
                ? downloadFile(input, request.signal, 'manual')
                : deleteFile(input, 'manual').map(jsonResponse)
        )
        .match({ Ok: (response) => response, Err: errorResponse });
