import pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { LibraryWarning, RemoteBmp } from '../../../models';
import { decodeSplitHeader, MAX_SPLIT_HEADER_BYTES } from '../../bmp/index';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import type { PhotosHeaders } from '../auth';
import { preparedDownloadUrl } from '../download';
import type { ThrottleScope } from '../throttle';
import { guardedSend } from '../transport';
import { contentIndex, contentKey, contentRecord, groupByContent } from './content-groups';
import type { LibraryCandidate } from './metadata';
import {
    chunkMetadataRecord,
    metadataItem,
    metadataMatches,
    type ChunkMetadataRecord,
    type ChunkMetadataStore
} from './metadata-store';

const HEADER_PROBE_BYTES = MAX_SPLIT_HEADER_BYTES;
const LIBRARY_PROBE_CONCURRENCY = 4;

type ProbedGroup = { group: LibraryCandidate[]; item: RemoteBmp | null };

async function probeUntilFound(
    groups: LibraryCandidate[][],
    probe: (group: LibraryCandidate[]) => AsyncResult<ProbedGroup, ServerError>
): Promise<Result<ProbedGroup, ServerError>[]> {
    // A continuation only needs proof that one Phodrive item exists.
    for (let offset = 0; offset < groups.length; offset += LIBRARY_PROBE_CONCURRENCY) {
        const batch = groups.slice(offset, offset + LIBRARY_PROBE_CONCURRENCY);
        const scanned = await Promise.all(batch.map(probe));
        if (
            scanned.some((result) =>
                result.match({ Ok: ({ item }) => item !== null, Err: () => true })
            )
        )
            return scanned;
    }

    return [];
}

/** Keep the photos on a library page whose first bytes hold a Phodrive split header. */
export function scanLibraryPage(
    page: { items: LibraryCandidate[]; nextPageToken: string; warnings?: LibraryWarning[] },
    headers: PhotosHeaders,
    fetcher: Fetcher,
    metadata?: ChunkMetadataStore,
    scope?: ThrottleScope,
    lookahead = false
): AsyncResult<
    { items: RemoteBmp[]; nextPageToken: string; warnings: LibraryWarning[] },
    ServerError
> {
    return Ok(undefined).andThenAsync(async () => {
        const warnings = [...(page.warnings ?? [])];
        const stored = metadata
            ? await metadata.load(page.items).match({
                  Ok: (rows) => rows,
                  Err: () => {
                      warnings.push({ code: 'METADATA_LOAD_FAILED' });

                      return new Map<string, ChunkMetadataRecord>();
                  }
              })
            : new Map<string, ChunkMetadataRecord>();
        const items = new Map<string, RemoteBmp>();
        const missing: LibraryCandidate[] = [];
        const records: ChunkMetadataRecord[] = [];
        const content = contentIndex(stored.values());

        for (const candidate of page.items) {
            const record = stored.get(candidate.mediaKey);
            if (record && metadataMatches(record, candidate)) {
                items.set(candidate.mediaKey, metadataItem(record, candidate));
                continue;
            }

            const shared = content.get(contentKey(candidate.sha1, candidate.size));
            if (shared) {
                const copied = contentRecord(shared, candidate);
                items.set(candidate.mediaKey, metadataItem(copied, candidate));
                records.push(copied);
                continue;
            }

            if (!candidate.trashed) missing.push(candidate);
        }

        const probe = (group: LibraryCandidate[]) =>
            probeLibraryItem(
                group[0],
                headers.commonHeaders,
                headers.rpcHeaders,
                fetcher,
                scope
            ).map((item) => ({ group, item }));

        const groups = groupByContent(missing);
        const scanned = lookahead
            ? items.size
                ? []
                : await probeUntilFound(groups, probe)
            : await pLimit(LIBRARY_PROBE_CONCURRENCY).map(groups, probe);

        for (const result of scanned) {
            if (result.isErr()) return result;

            result.inspect(({ group, item }) => {
                if (item === null) return;

                for (const candidate of group) {
                    const record = contentRecord(
                        chunkMetadataRecord(item, candidate.size),
                        candidate
                    );
                    items.set(candidate.mediaKey, metadataItem(record, candidate));
                    records.push(record);
                }
            });
        }

        if (metadata && records.length) {
            const saved = await metadata.save(records);
            if (saved.isErr()) warnings.push({ code: 'METADATA_SAVE_FAILED' });
        }

        return Ok({
            items: page.items.flatMap((candidate) => {
                const item = items.get(candidate.mediaKey);

                return item ? [item] : [];
            }),
            nextPageToken: page.nextPageToken,
            warnings
        });
    });
}

function readPrefix(response: Response): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync<Buffer, ServerError>(async () => {
        const reader = response.body?.getReader();
        if (!reader) return Err(SERVER_ERRORS.MISSING_DOWNLOAD_BODY);

        const parts: Uint8Array[] = [];
        let length = 0;

        try {
            while (length < HEADER_PROBE_BYTES) {
                const next = await reader.read();
                if (next.done) break;

                const part = next.value.subarray(0, HEADER_PROBE_BYTES - length);
                parts.push(part);
                length += part.length;
            }
        } catch {
            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);
        } finally {
            try {
                await reader.cancel();
            } catch {
                // The inspected bytes are still usable if cancellation fails.
            }
        }

        return Ok(Buffer.concat(parts, length));
    });
}

function fetchPrefix(
    url: URL,
    commonHeaders: Record<string, string>,
    fetcher: Fetcher,
    scope?: ThrottleScope
): AsyncResult<Buffer, ServerError> {
    const init: RequestInit = {
        method: 'GET',
        redirect: 'manual',
        headers: {
            ...commonHeaders,
            range: `bytes=0-${HEADER_PROBE_BYTES - 1}`
        },
        ...(scope?.signal ? { signal: scope.signal } : {})
    };

    if (scope)
        return guardedSend(scope, fetcher, url, init, 'Inspect photo header', {
            acceptedStatuses: [200, 206]
        })
            .mapErr((error) =>
                error.code === 'THROTTLED' || error.code === 'UPLOAD_CANCELLED'
                    ? error
                    : SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER
            )
            .andThenAsync((response) => readPrefix(response));

    return Ok(undefined).andThenAsync(async () => {
        let response: Response;

        try {
            response = await fetcher(url, init);
        } catch {
            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);
        }

        if (response.status !== 200 && response.status !== 206)
            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);

        return readPrefix(response);
    });
}

function probeLibraryItem(
    candidate: LibraryCandidate,
    commonHeaders: Record<string, string>,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher,
    scope?: ThrottleScope
): AsyncResult<RemoteBmp | null, ServerError> {
    return preparedDownloadUrl(candidate.mediaKey, candidate.sha1, rpcHeaders, fetcher, scope)
        .andThenAsync(async (url) => {
            if (url === null) return Ok(null);

            return await fetchPrefix(url, commonHeaders, fetcher, scope);
        })
        .map((prefix) => {
            if (prefix === null) return null;

            return decodeSplitHeader(prefix, candidate.size).match({
                Ok: ({ header }) => ({
                    ...candidate,
                    fileHash: header.fileHash,
                    fileId: header.fileId,
                    chunkIndex: header.chunkIndex,
                    isLast: header.flags === 1,
                    originalName: header.fileName,
                    folder: header.folder,
                    size: header.payloadSize
                }),
                Err: () => null
            });
        });
}
