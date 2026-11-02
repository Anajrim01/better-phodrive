import { handleAlbum } from '../_lib/album';
import { methodNotAllowed, rejectCrossOrigin } from '../_lib/http';

export const onRequest: PagesFunction = ({ request }) => {
    if (request.method !== 'POST') return methodNotAllowed('POST');

    const crossOrigin = rejectCrossOrigin(request);
    if (crossOrigin) return crossOrigin;

    return handleAlbum(request);
};
