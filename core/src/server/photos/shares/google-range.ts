import { Ok, type AsyncResult } from 'results-ts';
import type { ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import { readBody } from '../transport';
import {
    cancelBody,
    LIVE_STATUSES,
    publicFetch,
    readProbe,
    type PublicProbe
} from './google-public';

export type RangeRead = PublicProbe & {
    contentRange: string | null;
    contentLength: string | null;
    allowOrigin: string | null;
    exposeHeaders: string | null;
    body: Buffer;
};
export type RangePreflight = {
    status: number;
    allowOrigin: string | null;
    allowHeaders: string | null;
};

export function readRange(
    url: string,
    start: number,
    end: number,
    origin: string,
    fetcher: Fetcher
): AsyncResult<RangeRead, ServerError> {
    const stage = 'Read public range';
    const headers = {
        origin,
        range: `bytes=${start}-${end}`,
        // Browsers send identity with Range; a decoded body would not prove byte exactness.
        'accept-encoding': 'identity'
    };

    return publicFetch(fetcher, url, { method: 'GET', headers }, stage).andThenAsync(
        async (response) => {
            const read = {
                ...readProbe(response),
                contentRange: response.headers.get('content-range'),
                contentLength: response.headers.get('content-length'),
                allowOrigin: response.headers.get('access-control-allow-origin'),
                exposeHeaders: response.headers.get('access-control-expose-headers')
            };
            if (LIVE_STATUSES.has(response.status))
                return readBody(response, stage).map((body) => ({ ...read, body }));

            cancelBody(response);

            return Ok({ ...read, body: Buffer.alloc(0) });
        }
    );
}

export function isExactRange(read: RangeRead, start: number, end: number, total: number): boolean {
    const length = end - start + 1;

    return (
        read.status === 206 &&
        read.contentRange === `bytes ${start}-${end}/${total}` &&
        read.contentLength === String(length) &&
        read.body.length === length
    );
}

export function preflightRange(
    url: string,
    origin: string,
    fetcher: Fetcher
): AsyncResult<RangePreflight, ServerError> {
    return publicFetch(
        fetcher,
        url,
        {
            method: 'OPTIONS',
            headers: {
                origin,
                'access-control-request-method': 'GET',
                'access-control-request-headers': 'range'
            }
        },
        'Range preflight'
    ).map((response) => {
        const preflight = {
            status: response.status,
            allowOrigin: response.headers.get('access-control-allow-origin'),
            allowHeaders: response.headers.get('access-control-allow-headers')
        };
        cancelBody(response);

        return preflight;
    });
}
