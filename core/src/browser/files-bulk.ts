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
    action: FileActionKind;
    deleted: UploadedChunk[];
    error?: string;
    retryAfterSeconds?: number;
};

function failureMessage(action: FileActionKind): string {
    if (action === FileActionKind.DeleteForever) return 'Permanent delete failed';
    if (action === FileActionKind.Restore) return 'Restore failed';

    return 'Move to trash failed';
}

function bulkFileRequest(item: FileGroup, action: FileActionKind) {
    return [
        item.name,
        item.fileHash,
        item.fileId,
        chunksFor(item, action).map(({ mediaKey, sha1 }) => [mediaKey, sha1])
    ];
}

function failBulkFiles(
    files: readonly FileGroup[],
    error: ApplicationError,
    action: FileActionKind,
    onFile: (item: FileGroup, outcome: BulkDeleteFileOutcome) => void
): void {
    const retryAfterSeconds =
        error.code === 'THROTTLED' ? { retryAfterSeconds: error.retryAfterSeconds } : {};
    for (const item of files)
        onFile(item, {
            action,
            deleted: [],
            error: error.message,
            ...retryAfterSeconds
        });
}

function chunkIdentity(chunk: { mediaKey: string; sha1: string }): string {
    return `${chunk.mediaKey}\u0000${chunk.sha1}`;
}

function confirmedChunk(
    known: UploadedChunk,
    trashedAt: number | undefined,
    action: FileActionKind
): UploadedChunk {
    if (action === FileActionKind.Delete) return { ...known, trashedAt: trashedAt ?? Date.now() };

    if (action === FileActionKind.Restore) return { ...known, trashedAt: undefined };

    return { ...known };
}

function applyBulkEvent(
    event: BulkDeleteEvent,
    item: FileGroup,
    action: FileActionKind,
    onFile: (item: FileGroup, outcome: BulkDeleteFileOutcome) => void
): void {
    if (event.type === 'done') return;

    if (event.action !== action) {
        onFile(item, {
            action,
            deleted: [],
            error: INVALID_DELETE_RESPONSE.message
        });

        return;
    }

    const knownChunks = chunksFor(item, action);
    const requested = new Set(knownChunks.map(chunkIdentity));
    const confirmed = new Set<string>();
    const deleted: UploadedChunk[] = [];
    let invalid = false;

    for (const chunk of event.deleted) {
        const identity = chunkIdentity(chunk);
        const known = knownChunks.find((current) => chunkIdentity(current) === identity);
        if (!known || confirmed.has(identity)) {
            invalid = true;
            break;
        }
        confirmed.add(identity);
        deleted.push(confirmedChunk(known, chunk.trashedAt, action));
    }

    const error = invalid ? INVALID_DELETE_RESPONSE.message : event.error;
    const retryAfterSeconds = invalid ? undefined : event.retryAfterSeconds;
    if (!error && confirmed.size !== requested.size)
        onFile(item, { action, deleted, error: INVALID_DELETE_RESPONSE.message });
    else
        onFile(item, {
            action,
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
    action: FileActionKind,
    onFile: (item: FileGroup, outcome: BulkDeleteFileOutcome) => void
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const pending = new Map(files.map((item, index) => [index, item]));
        const reader = response.body?.getReader();
        if (!reader) {
            failBulkFiles(files, INVALID_DELETE_RESPONSE, action, onFile);

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
                failBulkFiles([...pending.values()], INVALID_DELETE_RESPONSE, action, onFile);
                pending.clear();

                return;
            }
            if (event.type === 'done') return;

            const item = pending.get(event.index);
            if (!item || event.action !== action || event.name !== item.name) {
                invalid = true;
                failBulkFiles([...pending.values()], INVALID_DELETE_RESPONSE, action, onFile);
                pending.clear();

                return;
            }
            applyBulkEvent(event, item, action, onFile);
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
                    message: failureMessage(action)
                },
                action,
                onFile
            );
            pending.clear();
        }

        if (pending.size > 0)
            failBulkFiles([...pending.values()], INVALID_DELETE_RESPONSE, action, onFile);

        return Ok(undefined);
    });
}

export function deleteFiles(
    email: string,
    token: string,
    files: readonly FileGroup[],
    workers: number,
    onFile: (item: FileGroup, outcome: BulkDeleteFileOutcome) => void,
    action: FileActionKind = FileActionKind.Delete
): AsyncResult<void, ApplicationError> {
    if (files.length === 0) return Ok(undefined).andThenAsync(async () => Ok(undefined));

    const init: RequestInit = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            action,
            email,
            token,
            workers,
            files: files.map((item) => bulkFileRequest(item, action))
        })
    };

    return Ok(undefined).andThenAsync(async () => {
        const received = await request(FILES_BULK_API_URL, init, failureMessage(action));

        return received.match<AsyncResult<void, ApplicationError>>({
            Ok: (response) => readBulkDeleteResponse(response, files, action, onFile),
            Err: (error) => {
                failBulkFiles(files, error, action, onFile);

                return Ok(undefined).andThenAsync(async () => Ok(undefined));
            }
        });
    });
}
