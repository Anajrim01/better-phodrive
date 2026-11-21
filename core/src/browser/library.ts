import type { ApplicationError } from '../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    GOOGLE_ACCOUNT_HEADER,
    LibraryBatchResponseSchema,
    LibraryResponseSchema,
    MAX_LIBRARY_BATCH_PAGES,
    type LibraryResponse,
    type LibraryWarning,
    type RemoteBmp
} from '../models';
import { schemaResult } from '../validation';
import { apiJson } from './api';

export type LibrarySnapshot = LibraryResponse & { pages: number };

/** Read one library page for one Google account, or for the server's default account. */
export function readLibraryPage(
    pageToken = '',
    accountId?: string
): AsyncResult<LibraryResponse, ApplicationError> {
    return requestLibrary(pageToken, accountId).andThen((value) =>
        schemaResult(LibraryResponseSchema, value, 'Could not load files.')
    );
}

function requestLibrary(pageToken: string, accountId?: string, pageCount?: number) {
    return apiJson(
        '/api/library',
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(accountId ? { [GOOGLE_ACCOUNT_HEADER]: accountId } : {})
            },
            body: JSON.stringify({ pageToken, pageCount })
        },
        'Could not load files.'
    );
}

/** Build a fresh snapshot to the loaded depth without changing the visible library mid-request. */
export function readLibrarySnapshot(
    pageCount: number,
    accountId?: string
): AsyncResult<LibrarySnapshot, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
        const warnings = new Map<LibraryWarning['code'], LibraryWarning>();
        const pageTokens = new Set<string>();
        let nextPageToken = '';
        let pages = 0;

        const depth = Math.max(1, pageCount);
        while (pages < depth) {
            const batchDepth = Math.min(depth - pages, MAX_LIBRARY_BATCH_PAGES);
            const received = await requestLibrary(nextPageToken, accountId, batchDepth).andThen(
                (value) => schemaResult(LibraryBatchResponseSchema, value, 'Could not load files.')
            );

            const merged = received.andThen((page): Result<void, ApplicationError> => {
                const repeatsPage = page.pageTokens.some((token) => pageTokens.has(token));
                for (const token of page.pageTokens) pageTokens.add(token);

                if (repeatsPage || (page.nextPageToken && pageTokens.has(page.nextPageToken))) {
                    return Err({
                        code: 'REPEATED_LIBRARY_PAGE',
                        message: 'Google Photos repeated a library page. Refresh to try again.'
                    } as const);
                }

                for (const item of page.items) items.set(item.mediaKey, item);
                for (const warning of page.warnings ?? []) {
                    const current = warnings.get(warning.code);
                    warnings.set(warning.code, {
                        code: warning.code,
                        ...(current?.count || warning.count
                            ? { count: (current?.count ?? 0) + (warning.count ?? 0) }
                            : {})
                    });
                }
                nextPageToken = page.nextPageToken;
                pages += page.pageTokens.length;

                return Ok(undefined);
            });

            if (merged.isErr()) return merged;
            if (!nextPageToken) break;
        }

        return Ok({
            items: [...items.values()],
            nextPageToken,
            warnings: [...warnings.values()],
            pages
        });
    });
}
