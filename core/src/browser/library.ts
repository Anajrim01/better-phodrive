import type { ApplicationError } from '../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { LibraryResponseSchema, type LibraryResponse, type RemoteBmp } from '../models';
import type { UploadedChunk } from '../files';
import {
    mergeGroupLibrary,
    type GroupAccountState,
    type GroupPage,
    type GroupPageError
} from '../groups';
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

/** Merge the newest page into a loaded snapshot without reading the rest of the library. */
export function readLibraryUpdates(
    email: string,
    token: string,
    current: readonly RemoteBmp[],
    nextPageToken: string,
    pageCount: number
): AsyncResult<LibrarySnapshot, ApplicationError> {
    return readLibraryPage(email, token).map((page) => {
        const items = new Map(current.map((item) => [item.mediaKey, item]));
        for (const item of page.items) items.set(item.mediaKey, item);

        return {
            items: [...items.values()],
            nextPageToken: pageCount === 0 ? page.nextPageToken : nextPageToken,
            pages: Math.max(1, pageCount)
        };
    });
}

function readPageResult(
    received: Result<LibraryResponse, ApplicationError>
): { page: LibraryResponse } | { error: GroupPageError } {
    return received.match<{ page: LibraryResponse } | { error: GroupPageError }>({
        Ok: (page) => ({ page }),
        Err: (error) => ({ error })
    });
}

async function readMemberPages(email: string, token: string): Promise<GroupPage> {
    const items = new Map<string, RemoteBmp>();
    const pageTokens = new Set<string>();
    let pageToken = '';

    do {
        pageTokens.add(pageToken);

        const received = await readLibraryPage(email, token, pageToken);
        const read = readPageResult(received);
        if ('error' in read) return { email, error: read.error };

        const page = read.page;
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

async function readMemberPage(email: string, token: string): Promise<GroupPage> {
    const received = await readLibraryPage(email, token);
    const read = readPageResult(received);
    if ('error' in read) return { email, error: read.error };

    return { email, items: read.page.items };
}

function missingMemberPage(email: string): GroupPage {
    return {
        email,
        error: { code: 'ACCOUNT_NOT_FOUND', message: `${email} is not connected.` }
    };
}

function pausedMemberPage(email: string, retryAfterSeconds: number): GroupPage {
    return {
        email,
        error: {
            code: 'THROTTLED',
            message: 'Google Photos is limiting requests',
            retryAfterSeconds
        }
    };
}

async function collectGroupPages(
    members: readonly { email: string; token: string; pausedUntil?: number }[],
    missing: readonly string[],
    readMember: (member: { email: string; token: string }) => Promise<GroupPage>
): Promise<GroupPage[]> {
    const pages = missing.map(missingMemberPage);
    const now = Date.now();

    for (const member of members) {
        if (member.pausedUntil && member.pausedUntil > now) {
            pages.push(
                pausedMemberPage(
                    member.email,
                    Math.max(1, Math.ceil((member.pausedUntil - now) / 1_000))
                )
            );

            continue;
        }

        pages.push(await readMember(member));
    }

    return pages;
}

function groupSnapshot(pages: readonly GroupPage[]): GroupLibrarySnapshot {
    const merged = mergeGroupLibrary(pages);

    return {
        chunks: merged.items,
        accounts: merged.accounts,
        partial: merged.partial
    };
}

/** Query every member, merge their items, and report a paused member instead of failing. */
export function readGroupLibrary(
    members: readonly { email: string; token: string; pausedUntil?: number }[],
    missing: readonly string[] = []
): AsyncResult<GroupLibrarySnapshot, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const pages = await collectGroupPages(members, missing, (member) =>
            readMemberPages(member.email, member.token)
        );

        return Ok(groupSnapshot(pages));
    });
}

/** Read only each member's newest page and keep the items already loaded. */
export function readGroupLibraryUpdates(
    members: readonly { email: string; token: string; pausedUntil?: number }[],
    missing: readonly string[] = [],
    loaded: readonly UploadedChunk[] = []
): AsyncResult<GroupLibrarySnapshot, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const updates = await collectGroupPages(members, missing, (member) =>
            readMemberPage(member.email, member.token)
        );
        const kept: GroupPage[] = members.map((member) => ({
            email: member.email,
            items: loaded.filter((item) => item.email.toLowerCase() === member.email.toLowerCase())
        }));

        return Ok(groupSnapshot([...updates, ...kept]));
    });
}
