import {
    BulkDeleteRequestSchema,
    type BulkDeleteRequest
} from '@madkarmaa/phodrive-core/bulk-delete';
import {
    trashValidatedFiles,
    validateBulkDelete,
    type BulkDeleteValidation
} from '@madkarmaa/phodrive-core/server/files';
import { errorResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

const NDJSON = 'application/x-ndjson';

function bulkResponse(input: BulkDeleteRequest, validation: BulkDeleteValidation): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const send = (event: unknown): void => {
                try {
                    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
                } catch {}
            };
            const fileEvent = (index: number, error: string) =>
                send({
                    type: 'file',
                    index,
                    name: input.files[index][0],
                    deleted: [],
                    error
                });
            const finish = (): void => {
                send({ type: 'done' });
                try {
                    controller.close();
                } catch {}
            };

            void trashValidatedFiles(
                input,
                validation,
                (result) => send({ type: 'file', ...result }),
                'manual'
            ).match({
                Ok: finish,
                Err: (error) => {
                    input.files.forEach((_, index) => fileEvent(index, error.message));
                    finish();
                }
            });
        }
    });

    return new Response(stream, {
        headers: {
            'cache-control': 'no-store',
            'content-type': NDJSON,
            'x-accel-buffering': 'no'
        }
    });
}

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, BulkDeleteRequestSchema, 'Invalid request')
        .andThenAsync((input) =>
            validateBulkDelete(input).map((validation) => ({ input, validation }))
        )
        .match({
            Ok: ({ input, validation }) => {
                if (validation.files.length === 0 && validation.invalid.length > 0)
                    return errorResponse({
                        code: 'INVALID_FILE_METADATA',
                        message: validation.invalid[0].error
                    });

                return bulkResponse(input, validation);
            },
            Err: errorResponse
        });
