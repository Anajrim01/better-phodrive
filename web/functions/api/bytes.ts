import { handleBytes } from '../_lib/bytes';

export interface ShareEdgeEnv {
    SHARE_CAPABILITY_KEY?: string;
}

type PagesContext = {
    request: Request;
    env: ShareEdgeEnv;
};

export function onRequest(context: PagesContext): Promise<Response> {
    return handleBytes(context.request, {
        fetch: globalThis.fetch.bind(globalThis),
        secret: context.env.SHARE_CAPABILITY_KEY
    });
}
