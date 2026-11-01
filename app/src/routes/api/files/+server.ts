import { FileActionKind, FileRequestSchema } from '@madkarmaa/phodrive-core/models';
import {
    deleteFile,
    deleteForeverFile,
    downloadFile,
    restoreFile
} from '@madkarmaa/phodrive-core/server/files';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, FileRequestSchema, 'Invalid request')
        .andThenAsync((input) => {
            if (input.action === FileActionKind.Download)
                return downloadFile(input, request.signal, 'manual');
            if (input.action === FileActionKind.Restore)
                return restoreFile(input, 'manual').map(jsonResponse);
            if (input.action === FileActionKind.DeleteForever)
                return deleteForeverFile(input, 'manual').map(jsonResponse);

            return deleteFile(input, 'manual').map(jsonResponse);
        })
        .match({ Ok: (response) => response, Err: errorResponse });
