import { ALBUM_URL, SECRETS } from './google-share-fake-secrets';

export type PublicMedia = { sha1: string; key: string; body: Uint8Array };

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'content-range, content-length, accept-ranges'
};

export function shortAnswer(linkOn: boolean): Response {
    return linkOn
        ? new Response(null, { status: 302, headers: { location: ALBUM_URL } })
        : new Response(null, { status: 404 });
}

export function pageAnswer(linkOn: boolean): Response {
    if (!linkOn) return new Response(null, { status: 404 });

    const request = JSON.stringify([SECRETS.uid, null, null, SECRETS.key]);

    return new Response(
        `<script>AF_dataServiceRequests = {'ds:1' : {id:'rpcOne',request:${request}}};</script>`,
        { headers: { 'content-type': 'text/html' } }
    );
}

export function listingAnswer(media: readonly PublicMedia[], nextToken: unknown): Response {
    const items = media.map(({ sha1, key }) => [
        key,
        [`https://lh3.googleusercontent.com/pw/${key}`, 32, 32],
        1,
        Buffer.from(sha1, 'hex').toString('base64url')
    ]);
    const metadata = new Array(22).fill(null);
    metadata[21] = items.length;

    const data = [null, items, nextToken ?? null, metadata];
    const frame = JSON.stringify([['wrb.fr', 'rpcOne', JSON.stringify(data), null]]);

    return new Response(`)]}'\n\n${frame.length}\n${frame}\n`);
}

export function mediaAnswer(
    media: Pick<PublicMedia, 'key' | 'body'> | undefined,
    range: string | null
): Response {
    if (!media) return new Response(null, { status: 404 });

    const [start, end] = (range ?? 'bytes=0-0').slice('bytes='.length).split('-').map(Number);
    const body = media.body.slice(start, end + 1);

    return new Response(body, {
        status: 206,
        headers: {
            ...CORS,
            'content-range': `bytes ${start}-${end}/${media.body.length}`,
            'content-length': String(body.length)
        }
    });
}

export function preflightAnswer(): Response {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
}
