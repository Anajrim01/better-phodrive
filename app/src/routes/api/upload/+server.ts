import { receiveUpload } from '@phodrive/core/server/upload/input';
import { uploadStream } from '@phodrive/core/server/upload/stream';
import { errorResponse } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    receiveUpload(request).match({ Ok: uploadStream, Err: errorResponse });
