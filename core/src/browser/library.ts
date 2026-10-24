import type { ApplicationError } from '../errors.js';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { LibraryResponseSchema, type LibraryResponse, type RemoteBmp } from '../models.js';
import { schemaResult } from '../validation.js';
import { apiJson } from './api.js';

export type LibrarySnapshot = LibraryResponse & { pages: number };

export function readLibraryPage(
    email: string,
    token: string,
    pageToken = ''
): AsyncResult<LibraryResponse, ApplicationError> {
    return apiJson(
        '/api/library',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, token, pageToken })
        },
        'Could not load files.'
    ).andThen((value) => schemaResult(LibraryResponseSchema, value, 'Could not load files.'));
}

/** Build a fresh snapshot to the loaded depth without changing the visible library mid-request. */
export function readLibrarySnapshot(
    email: string,
    token: string,
    pageCount: number
): AsyncResult<LibrarySnapshot, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
        const pageTokens = new Set<string>();
        let nextPageToken = '';
        let pages = 0;

        for (let index = 0; index < Math.max(1, pageCount); index++) {
            pageTokens.add(nextPageToken);

            const received = await readLibraryPage(email, token, nextPageToken);

            const merged = received.andThen((page): Result<void, ApplicationError> => {
                if (page.nextPageToken && pageTokens.has(page.nextPageToken)) {
                    return Err({
                        code: 'REPEATED_LIBRARY_PAGE',
                        message: 'Google Photos repeated a library page. Refresh to try again.'
                    } as const);
                }

                for (const item of page.items) items.set(item.mediaKey, item);
                nextPageToken = page.nextPageToken;
                pages++;

                return Ok(undefined);
            });

            if (merged.isErr()) return merged;
            if (!nextPageToken) break;
        }

        return Ok({ items: [...items.values()], nextPageToken, pages });
    });
}
