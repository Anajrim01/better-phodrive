import type { ApplicationError } from '../errors';
import { BulkDeleteEventSchema, type BulkDeleteEvent } from '../bulk-delete';
import { FileActionKind } from '../models';
import { Ok, type AsyncResult } from 'results-ts';
import type { FileGroup, UploadedChunk } from '../files';
import { schemaResult } from '../validation';
import { request } from './api';
import { chunksFor, INVALID_DELETE_RESPONSE } from './file-action-helpers';

const FILES_BULK_API_URL = '/api/files/bulk';

export type BulkDeleteFileOutcome = {
    deleted: UploadedChunk[];
    error?: string;
    retryAfterSeconds?: number;
};

function bulkFileRequest(item: FileGroup) {
    return {
        name: item.name,
        chunks: chunksFor(item, FileActionKind.Delete).map(({ mediaKey, sha1 }) => ({
            mediaKey,
            sha1
        }))
    };
}

function failBulkFiles(
    files: readonly FileGroup[],
    error: ApplicationError,
    onFile: (item: FileGroup, outcome: BulkDeleteFileOutcome) => void
): void {
    const retryAfterSeconds =
        error.code === 'THROTTLED' ? { retryAfterSeconds: error.retryAfterSeconds } : {};
    for (const item of files)
        onFile(item, { deleted: [], error: error.message, ...retryAfterSeconds });
}

function applyBulkEvent(
    event: BulkDeleteEvent,
    item: FileGroup,
    onFile: (item: FileGroup, outcome: BulkDeleteFileOutcome) => void
): void {
    if (event.type === 'done') return;

    const knownChunks = [...item.chunks, ...item.duplicates];
    const deleted: UploadedChunk[] = [];
    let invalid = false;

    for (const chunk of event.deleted) {
        const known = knownChunks.find(
            (current) => current.mediaKey === chunk.mediaKey && current.sha1 === chunk.sha1
        );
        if (!known) {
            invalid = true;
            break;
        }
        deleted.push({ ...known, trashedAt: chunk.trashedAt });
    }

    const error = invalid ? INVALID_DELETE_RESPONSE.message : event.error;
    const retryAfterSeconds = invalid ? undefined : event.retryAfterSeconds;
    if (!error && deleted.length !== knownChunks.length)
        onFile(item, { deleted, error: INVALID_DELETE_RESPONSE.message });
    else
        onFile(item, {
            deleted,
            ...(error ? { error } : {}),
            ...(retryAfterSeconds ? { retryAfterSeconds } : {})
        });
}

function parseEvent(line: string): BulkDeleteEvent | null {
    let body: unknown;
    try {
        body = JSON.parse(line);
    } catch {
        body = null;
    }
    const parsed = schemaResult(BulkDeleteEventSchema, body, INVALID_DELETE_RESPONSE.message);

    return parsed.match<BulkDeleteEvent | null>({
        Ok: (value) => value,
        Err: () => null
    });
}

function readLines(buffer: string, handleLine: (line: string) => void): string {
    let lineEnd = buffer.indexOf('\n');
    while (lineEnd >= 0) {
        handleLine(buffer.slice(0, lineEnd));
        buffer = buffer.slice(lineEnd + 1);
        lineEnd = buffer.indexOf('\n');
    }

    return buffer;
}

function readBulkDeleteResponse(
    response: Response,
    files: readonly FileGroup[],
    onFile: (item: FileGroup, outcome: BulkDeleteFileOutcome) => void
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const pending = new Map(files.map((item, index) => [index, item]));
        const reader = response.body?.getReader();
        if (!reader) {
            failBulkFiles(files, INVALID_DELETE_RESPONSE, onFile);

            return Ok(undefined);
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let invalid = false;

        const handleLine = (line: string): void => {
            if (invalid || !line.trim()) return;

            const event = parseEvent(line);
            if (event === null) {
                invalid = true;
                failBulkFiles([...pending.values()], INVALID_DELETE_RESPONSE, onFile);
                pending.clear();

                return;
            }
            if (event.type === 'done') return;

            const item = pending.get(event.index);
            if (!item) {
                invalid = true;
                failBulkFiles([...pending.values()], INVALID_DELETE_RESPONSE, onFile);
                pending.clear();

                return;
            }
            applyBulkEvent(event, item, onFile);
            pending.delete(event.index);
        };

        try {
            while (true) {
                const next = await reader.read();
                if (next.done) break;

                buffer += decoder.decode(next.value, { stream: true });
                buffer = readLines(buffer, handleLine);
            }
            buffer += decoder.decode();
            if (buffer.trim()) handleLine(buffer);
        } catch {
            failBulkFiles(
                [...pending.values()],
                {
                    code: 'REQUEST_FAILED',
                    message: 'Move to trash failed'
                },
                onFile
            );
            pending.clear();
        }

        if (pending.size > 0) failBulkFiles([...pending.values()], INVALID_DELETE_RESPONSE, onFile);

        return Ok(undefined);
    });
}

export function deleteFiles(
    email: string,
    token: string,
    files: readonly FileGroup[],
    onFile: (item: FileGroup, outcome: BulkDeleteFileOutcome) => void
): AsyncResult<void, ApplicationError> {
    if (files.length === 0) return Ok(undefined).andThenAsync(async () => Ok(undefined));

    const init: RequestInit = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            email,
            token,
            files: files.map(bulkFileRequest)
        })
    };

    return Ok(undefined).andThenAsync(async () => {
        const received = await request(FILES_BULK_API_URL, init, 'Move to trash failed');

        return received.match<AsyncResult<void, ApplicationError>>({
            Ok: (response) => readBulkDeleteResponse(response, files, onFile),
            Err: (error) => {
                failBulkFiles(files, error, onFile);

                return Ok(undefined).andThenAsync(async () => Ok(undefined));
            }
        });
    });
}
