import type { ApplicationError } from '../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { LibraryResponseSchema, type LibraryResponse, type RemoteBmp } from '../models';
import type { UploadedChunk } from '../files';
import { mergeGroupLibrary, type GroupAccountState, type GroupPage } from '../groups';
import { schemaResult } from '../validation';
import { apiJson } from './api';

export type LibrarySnapshot = LibraryResponse & { pages: number };

export type GroupLibrarySnapshot = {
    chunks: UploadedChunk[];
    accounts: GroupAccountState[];
    partial: boolean;
};

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

async function readMemberPages(email: string, token: string): Promise<GroupPage> {
    const items = new Map<string, RemoteBmp>();
    const pageTokens = new Set<string>();
    let pageToken = '';

    do {
        pageTokens.add(pageToken);

        const received = await readLibraryPage(email, token, pageToken);
        if (received.isErr()) return { email, error: received.unwrapErr() };

        const page = received.unwrap();
        if (page.nextPageToken && pageTokens.has(page.nextPageToken))
            return {
                email,
                error: {
                    code: 'REPEATED_LIBRARY_PAGE',
                    message: 'Google Photos repeated a library page. Refresh to try again.'
                }
            };

        for (const item of page.items) items.set(item.mediaKey, item);
        pageToken = page.nextPageToken;
    } while (pageToken);

    return { email, items: [...items.values()] };
}

/** Query every member, merge their items, and report a paused member instead of failing. */
export function readGroupLibrary(
    members: readonly { email: string; token: string; pausedUntil?: number }[]
): AsyncResult<GroupLibrarySnapshot, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const pages: GroupPage[] = [];
        const now = Date.now();

        for (const member of members) {
            if (member.pausedUntil && member.pausedUntil > now) {
                pages.push({
                    email: member.email,
                    error: {
                        code: 'THROTTLED',
                        message: 'Google Photos is limiting requests',
                        retryAfterSeconds: Math.max(
                            1,
                            Math.ceil((member.pausedUntil - now) / 1_000)
                        )
                    }
                });

                continue;
            }

            pages.push(await readMemberPages(member.email, member.token));
        }

        const merged = mergeGroupLibrary(pages);

        return Ok({
            chunks: merged.items,
            accounts: merged.accounts,
            partial: merged.partial
        });
    });
}
