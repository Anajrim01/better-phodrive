export interface ProxyError {
    code: string;
    message: string;
    status: number;
}

const errors = {
    INVALID_REQUEST: {
        message: 'The request was not valid.',
        status: 400
    },
    INVALID_ALBUM: {
        message: 'Paste a public Google Photos album link.',
        status: 400
    },
    INVALID_BYTES_URL: {
        message: 'That file address is not allowed.',
        status: 400
    },
    INVALID_RANGE: {
        message: 'That byte range is not allowed.',
        status: 400
    },
    CROSS_ORIGIN: {
        message: 'Cross-origin requests are not allowed.',
        status: 403
    },
    ALBUM_UNAVAILABLE: {
        message: 'This album is not public or no longer exists.',
        status: 404
    },
    MEDIA_UNAVAILABLE: {
        message: 'This shared item is no longer available.',
        status: 404
    },
    ALBUM_RESPONSE_TOO_LARGE: {
        message: 'The album returned too much data.',
        status: 502
    },
    ALBUM_SHAPE_CHANGED: {
        message: 'The album listing format changed. The share cannot be read safely.',
        status: 502
    },
    ALBUM_INCOMPLETE: {
        message: 'The album listing is incomplete. The share cannot be read safely.',
        status: 502
    },
    ALBUM_MISMATCH: {
        message: 'The album returned two different listings.',
        status: 502
    },
    UPSTREAM_UNAVAILABLE: {
        message: 'Google Photos did not respond.',
        status: 502
    },
    UPSTREAM_REDIRECT: {
        message: 'Google Photos redirected the media request.',
        status: 502
    },
    UPSTREAM_STATUS: {
        message: 'Google Photos refused the media request.',
        status: 502
    },
    RANGE_NOT_SATISFIED: {
        message: 'The requested byte range is outside the item.',
        status: 416
    },
    BUSY: {
        message: 'The proxy is busy. Try again in a moment.',
        status: 429
    }
} as const;

export type ProxyErrorCode = keyof typeof errors;

export function proxyError(code: ProxyErrorCode): ProxyError {
    return { code, ...errors[code] };
}
