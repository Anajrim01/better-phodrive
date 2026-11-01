import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Ok, type AsyncResult, type Result } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import pLimit from 'p-limit';
import { authenticatedHeaders, type PhotosHeaders } from '../auth';
import { photosFetch, type Fetcher } from '../../fetcher';
import { guardedSend, readBody } from '../transport';
import { bodyBytes } from '../../protobuf';
import { pageRequest, parseLibraryPage, stateRequest, type ParsedLibraryPage } from './metadata';
import { LIBRARY_STATE_REQUEST } from './requests';
import { namedAsNonPhodrive, parseChunkName, probeLibraryItem, trashedChunkItem } from './probe';

const LIBRARY_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/18047484249733410717';
const LIBRARY_PROBE_CONCURRENCY = 2;
const REJECTED_SYNC_CODES = new Set([
    'INVALID_PROTOBUF_FIELD',
    'INVALID_PROTOBUF_FIELD_TYPE',
    'INVALID_PROTOBUF_INTEGER',
    'TRUNCATED_PROTOBUF_FIELD',
    'UNSUPPORTED_PROTOBUF_FIELD',
    'MISSING_OR_AMBIGUOUS_PROTOBUF_FIELD',
    'OVERSIZED_PROTOBUF_INTEGER',
    'INVALID_UTF_8_IN_RESPONSE'
]);
const REJECTED_SYNC_STATUSES = new Set([400, 404, 410]);

function classifyDeltaError(error: ServerError): ServerError {
    if (error.code === 'REQUEST_FAILED' && error.status !== undefined) {
        return REJECTED_SYNC_STATUSES.has(error.status)
            ? SERVER_ERRORS.LIBRARY_SYNC_REJECTED
            : error;
    }

    return REJECTED_SYNC_CODES.has(error.code) ? SERVER_ERRORS.LIBRARY_SYNC_REJECTED : error;
}

export type LibraryPage = {
    items: RemoteBmp[];
    nextPageToken: string;
    syncToken?: Buffer;
    deletedMediaKeys: string[];
    trashedMediaKeys: string[];
    skippedMediaKeys: string[];
};

function libraryRequest(
    pageToken: string,
    syncToken: Buffer | undefined
): Result<Buffer, ServerError> {
    if (syncToken && !pageToken) return stateRequest(syncToken);
    if (pageToken) return pageRequest(Buffer.from(pageToken, 'base64url'), syncToken);

    return Ok(Buffer.from(LIBRARY_STATE_REQUEST, 'base64'));
}

export function readLibraryPage(
    email: string,
    token: string,
    pageToken: string,
    syncToken: Buffer | undefined,
    fetcher: Fetcher = photosFetch
): AsyncResult<LibraryPage, ServerError> {
    return authenticatedHeaders(email, token, fetcher).andThenAsync(async (headers) => {
        const request = libraryRequest(pageToken, syncToken);
        const received = await request.andThenAsync((body) =>
            guardedSend(
                email,
                fetcher,
                LIBRARY_URL,
                {
                    method: 'POST',
                    redirect: 'manual',
                    headers: headers.rpcHeaders,
                    body: bodyBytes(body)
                },
                'Library list'
            )
                .andThenAsync((response) => readBody(response, 'Library list'))
                .andThen(parseLibraryPage)
        );
        const classified = syncToken ? received.mapErr(classifyDeltaError) : received;

        return classified.andThenAsync(async (page) =>
            scanLibraryPage(email, page, headers, fetcher)
        );
    });
}

function scanLibraryPage(
    email: string,
    page: ParsedLibraryPage,
    headers: PhotosHeaders,
    fetcher: Fetcher
): AsyncResult<LibraryPage, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const candidates = page.items.filter((candidate) => !namedAsNonPhodrive(candidate));
        const visible = candidates.filter((candidate) => !candidate.trashed);
        const hidden = candidates.filter((candidate) => candidate.trashed);
        const limit = pLimit(LIBRARY_PROBE_CONCURRENCY);
        const scanned = await limit.map(visible, (candidate) =>
            probeLibraryItem(email, candidate, headers.commonHeaders, headers.rpcHeaders, fetcher)
        );

        const itemsByKey = new Map<string, RemoteBmp>();
        const folders = new Map<string, string>();

        for (const result of scanned) {
            if (result.isErr()) return result;

            result.inspect((item) => {
                if (item === null) return;

                itemsByKey.set(item.mediaKey, item);
                const key = chunkKey(item.fileHash, item.originalName);
                if (item.folder && key) folders.set(key, item.folder);
            });
        }

        for (const candidate of hidden) {
            const parsed = parseChunkName(candidate.fileName);
            const key = parsed ? chunkKey(parsed.fileHash, parsed.originalName) : null;
            const item = trashedChunkItem(email, candidate, key ? folders.get(key) : undefined);
            if (item) itemsByKey.set(item.mediaKey, item);
        }

        const items = candidates.flatMap((candidate) => {
            const item = itemsByKey.get(candidate.mediaKey);

            return item ? [item] : [];
        });

        return Ok({
            items,
            nextPageToken: page.nextPageToken,
            ...(page.syncToken ? { syncToken: page.syncToken } : {}),
            deletedMediaKeys: page.deletedMediaKeys,
            trashedMediaKeys: [
                ...page.hiddenMediaKeys,
                ...page.items
                    .filter((candidate) => candidate.trashed)
                    .map((candidate) => candidate.mediaKey)
            ],
            skippedMediaKeys: page.items
                .filter((candidate) => !candidate.trashed && namedAsNonPhodrive(candidate))
                .map((candidate) => candidate.mediaKey)
        });
    });
}

function chunkKey(fileHash: string, originalName?: string): string | null {
    return originalName === undefined ? null : `${fileHash}\u0000${originalName}`;
}
