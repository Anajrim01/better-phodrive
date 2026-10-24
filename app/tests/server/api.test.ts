import { LibraryRequestSchema } from '@phodrive/core/models';
import { expect, test } from 'vitest';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';

function jsonRequest(body: string): Request {
    return new Request('http://localhost/api/library', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
    });
}

test('validates JSON requests against their schema', async () => {
    const valid = await readJsonRequest(
        jsonRequest(JSON.stringify({ email: 'test@example.com', token: 'aas_et/token' })),
        LibraryRequestSchema,
        'Invalid request'
    );
    expect(valid.unwrap()).toEqual({ email: 'test@example.com', token: 'aas_et/token' });

    const malformed = await readJsonRequest(jsonRequest('{'), LibraryRequestSchema, 'Invalid');
    expect(malformed.unwrapErr().code).toBe('INVALID_JSON_REQUEST');

    const invalid = await readJsonRequest(jsonRequest('{}'), LibraryRequestSchema, 'Invalid');
    expect(invalid.unwrapErr()).toEqual({ code: 'INVALID_SCHEMA', message: 'Invalid' });
});

test('never caches API results or errors', async () => {
    const result = jsonResponse({ items: [] });
    expect(result.headers.get('cache-control')).toBe('no-store');

    const failure = errorResponse({ message: 'Invalid request' });
    expect(failure.status).toBe(400);
    expect(failure.headers.get('cache-control')).toBe('no-store');

    const body: unknown = await failure.json();
    expect(body).toEqual({ error: 'Invalid request' });
});
