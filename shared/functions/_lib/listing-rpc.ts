import { Err, Ok, type Result } from 'results-ts';
import { proxyError, type ProxyError } from './errors';

function parseBatchPayload(text: string, rpcId: string): Result<unknown, ProxyError> {
    const body = text.replace(/^\)\]\}'\s*/, '');
    const candidates: unknown[] = [];

    try {
        candidates.push(JSON.parse(body));
    } catch {
        for (const line of body.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('[')) continue;

            try {
                candidates.push(JSON.parse(trimmed));
            } catch {
                continue;
            }
        }
    }

    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;

        for (const entry of candidate) {
            if (!Array.isArray(entry) || entry[0] !== 'wrb.fr' || entry[1] !== rpcId) continue;
            if (typeof entry[2] !== 'string') return Err(proxyError('ALBUM_SHAPE_CHANGED'));

            try {
                return Ok(JSON.parse(entry[2]));
            } catch {
                return Err(proxyError('ALBUM_SHAPE_CHANGED'));
            }
        }
    }

    return Err(proxyError('ALBUM_SHAPE_CHANGED'));
}

export function parseBatchExecute(text: string, rpcId: string): Result<unknown, ProxyError> {
    return parseBatchPayload(text, rpcId);
}
