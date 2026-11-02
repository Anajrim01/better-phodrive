import { Err, Ok, type Result } from 'results-ts';
import { proxyError, type ProxyError } from './errors';

const RPC_ID = /^[A-Za-z0-9_]{4,32}$/;

export interface ServiceRequest {
    id: string;
    request: (string | null)[];
}

export interface InitDataCallback {
    key: string;
    data: unknown;
}

function balancedEnd(text: string, start: number): number | null {
    const opening = text[start];
    const closing = opening === '{' ? '}' : ']';
    let depth = 0;
    let quote = '';

    for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (quote) {
            if (char === '\\') index++;
            else if (char === quote) quote = '';
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === opening) depth++;
        else if (char === closing) {
            depth--;
            if (depth === 0) return index + 1;
        }
    }

    return null;
}

function objectAfter(
    text: string,
    marker: string,
    from = 0
): { start: number; end: number } | null {
    const markerIndex = text.indexOf(marker, from);
    if (markerIndex < 0) return null;

    const start = text.indexOf('{', markerIndex + marker.length);
    if (start < 0) return null;

    const end = balancedEnd(text, start);

    return end === null ? null : { start, end };
}

function parseRequestArray(value: string): Result<(string | null)[], ProxyError> {
    try {
        const parsed: unknown = JSON.parse(value);
        if (
            !Array.isArray(parsed) ||
            !parsed.every((item) => item === null || typeof item === 'string')
        )
            return Err(proxyError('ALBUM_SHAPE_CHANGED'));

        return Ok(parsed);
    } catch {
        return Err(proxyError('ALBUM_SHAPE_CHANGED'));
    }
}

export function extractServiceRequests(html: string): Result<ServiceRequest[], ProxyError> {
    const block = objectAfter(html, 'AF_dataServiceRequests');
    if (!block) return Ok([]);

    const object = html.slice(block.start, block.end);
    const ids = [...object.matchAll(/id\s*:\s*'([^']+)'/g)].map((match) => match[1]);
    const requests = [...object.matchAll(/request\s*:\s*(\[[^\]]*\])/g)].map((match) => match[1]);
    if (ids.length !== requests.length) return Err(proxyError('ALBUM_SHAPE_CHANGED'));

    const entries: ServiceRequest[] = [];
    for (const [index, id] of ids.entries()) {
        if (!RPC_ID.test(id)) return Err(proxyError('ALBUM_SHAPE_CHANGED'));

        const parsed = parseRequestArray(requests[index]).map((request) => {
            entries.push({ id, request });

            return undefined;
        });
        if (parsed.isErr()) return parsed;
    }

    return Ok(entries);
}

export function extractInitDataCallbacks(html: string): InitDataCallback[] {
    const callbacks: InitDataCallback[] = [];
    const marker = 'AF_initDataCallback(';
    let cursor = 0;

    for (;;) {
        const block = objectAfter(html, marker, cursor);
        if (!block) break;

        cursor = block.end;
        const object = html.slice(block.start, block.end);
        const key = /key\s*:\s*'([^']+)'/.exec(object)?.[1];
        const dataIndex = object.indexOf('data:');
        if (!key || dataIndex < 0) continue;

        const dataStart = object.indexOf('[', dataIndex);
        if (dataStart < 0) continue;

        const dataEnd = balancedEnd(object, dataStart);
        if (dataEnd === null) continue;

        try {
            callbacks.push({ key, data: JSON.parse(object.slice(dataStart, dataEnd)) });
        } catch {
            continue;
        }
    }

    return callbacks;
}

export function pickServiceRequest(
    entries: ServiceRequest[],
    uid: string,
    key: string
): ServiceRequest | undefined {
    const matching = entries.filter(
        (entry) =>
            entry.request[0] === uid && entry.request.includes(key) && entry.request.length >= 4
    );
    if (matching.length === 1) return matching[0];

    return entries.find((entry) => entry.id === 'snAcKc' && entry.request.includes(key));
}
