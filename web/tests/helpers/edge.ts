import { CAPABILITY_AAD } from '../../functions/_lib/capability';

export const KEY = Buffer.alloc(32, 9);
export const SECRET = KEY.toString('base64');
export const MEDIA_URL =
    'https://lh3.googleusercontent.com/pw/abcdefghijklmnopqrstuvwxyz0123456789';

type Payload = {
    v: 1;
    s: string;
    f: string;
    c: number;
    u: string;
    o: number;
    p: number;
    n: number;
    e: number;
};

export const OFFSET = 200;
export const PAYLOAD = 1_000;
export const TOTAL = 1_500;

export async function capability(overrides: Partial<Payload> = {}): Promise<string> {
    const payload: Payload = {
        v: 1,
        s: 'share-id',
        f: 'file-id',
        c: 0,
        u: MEDIA_URL,
        o: OFFSET,
        p: PAYLOAD,
        n: TOTAL,
        e: Math.floor(Date.now() / 1000) + 300,
        ...overrides
    };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', KEY, { name: 'AES-GCM' }, false, ['encrypt']);
    const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: CAPABILITY_AAD },
            key,
            new TextEncoder().encode(JSON.stringify(payload))
        )
    );
    const raw = new Uint8Array(1 + iv.length + sealed.length);
    raw[0] = 1;
    raw.set(iv, 1);
    raw.set(sealed, 1 + iv.length);

    return Buffer.from(raw).toString('base64url');
}

export function request(token: string | null, range?: string, signal?: AbortSignal): Request {
    return new Request('https://phodrive.example/api/bytes', {
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(range ? { range } : {})
        },
        ...(signal ? { signal } : {})
    });
}

export function rangedBody(length: number, producers = 1): ReadableStream<Uint8Array> {
    const chunk = new Uint8Array(Math.ceil(length / producers));

    return new ReadableStream({
        start(controller) {
            for (let sent = 0; sent < length; sent += chunk.length)
                controller.enqueue(chunk.subarray(0, Math.min(chunk.length, length - sent)));
            controller.close();
        }
    });
}

export function rangeResponse(
    length: number,
    body = rangedBody(length),
    offset = OFFSET,
    total = TOTAL
): Response {
    return new Response(body, {
        status: 206,
        headers: {
            'content-range': `bytes ${offset}-${offset + length - 1}/${total}`,
            'content-length': String(length)
        }
    });
}

export async function bodyLength(response: Response): Promise<number> {
    if (!response.body) return 0;

    const reader = response.body.getReader();
    let total = 0;

    while (true) {
        const next = await reader.read();
        if (next.done) return total;
        total += next.value.byteLength;
    }
}
