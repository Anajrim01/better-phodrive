import type { PhotosHeaders } from './auth';

const AUTH_CACHE_LIMIT = 64;
const AUTH_CACHE_MARGIN_MS = 30_000;

type CachedAuth = { headers: PhotosHeaders; expiresAt: number };

const AUTH_CACHE = new Map<string, CachedAuth>();

function cacheKey(email: string, token: string): string {
    return `${email}\u0000${token}`;
}

export function readAuthHeaders(
    email: string,
    token: string,
    now = Date.now()
): PhotosHeaders | undefined {
    const key = cacheKey(email, token);
    const cached = AUTH_CACHE.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt - AUTH_CACHE_MARGIN_MS <= now) {
        AUTH_CACHE.delete(key);

        return undefined;
    }

    return cached.headers;
}

export function writeAuthHeaders(
    email: string,
    token: string,
    headers: PhotosHeaders,
    expiresAt: number
): void {
    const key = cacheKey(email, token);

    AUTH_CACHE.delete(key);
    AUTH_CACHE.set(key, { headers, expiresAt });

    while (AUTH_CACHE.size > AUTH_CACHE_LIMIT) {
        const oldest = AUTH_CACHE.keys().next().value;
        if (oldest === undefined) break;

        AUTH_CACHE.delete(oldest);
    }
}

export function invalidateAuth(email: string): void {
    const prefix = `${email}\u0000`;

    for (const key of AUTH_CACHE.keys()) {
        if (key.startsWith(prefix)) AUTH_CACHE.delete(key);
    }
}

export function clearAuthCache(): void {
    AUTH_CACHE.clear();
}
