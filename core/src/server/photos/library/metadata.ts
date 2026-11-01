import type { ServerError } from '../../errors';
import { Ok, type Result } from 'results-ts';
import { Sha1HexSchema } from '../../../models';
import { MAX_PHOTOS_BMP_BYTES, BMP_HEADER_BYTES } from '../../bmp/index';
import { LIBRARY_PAGE_REQUEST, LIBRARY_STATE_REQUEST } from './requests';
import {
    bytes,
    parse,
    nested,
    integer,
    utf8,
    optional,
    encodeFields,
    type Field
} from '../../protobuf';

function requestWithOuter(
    base64: string,
    update: (outer: Field[]) => Field[]
): Result<Buffer, ServerError> {
    return parse(Buffer.from(base64, 'base64'))
        .andThen((fields) =>
            bytes(fields, 1)
                .andThen(parse)
                .map((outer) => ({ fields, outer }))
        )
        .map(({ fields, outer }) =>
            encodeFields(
                fields.map((field) =>
                    field.number === 1 ? { number: 1, value: encodeFields(update(outer)) } : field
                )
            )
        );
}

export function pageRequest(resume: Buffer, syncToken?: Buffer): Result<Buffer, ServerError> {
    return requestWithOuter(LIBRARY_PAGE_REQUEST, (outer) => {
        // The resume token belongs at 1.4; 1.6 is the sync context; 1.1 is the metadata mask.
        const updated = outer.filter(
            (field) => field.number !== 4 && (syncToken === undefined || field.number !== 6)
        );
        updated.push({ number: 4, value: resume });
        if (syncToken !== undefined) updated.push({ number: 6, value: syncToken });

        return updated;
    });
}

/** The first delta call is a state request with 1.6 set and no resume field. */
export function stateRequest(syncToken: Buffer): Result<Buffer, ServerError> {
    return requestWithOuter(LIBRARY_STATE_REQUEST, (outer) => [
        ...outer.filter((field) => field.number !== 4 && field.number !== 6),
        { number: 6, value: syncToken }
    ]);
}

export type LibraryCandidate = {
    size: number;
    at: number;
    mediaKey: string;
    sha1: string;
    fileName?: string;
};

type ParsedLibraryItem = { candidate: LibraryCandidate } | { hiddenMediaKey: string };

function itemMediaKey(item: Field[]): Result<string, ServerError> {
    return bytes(item, 1).andThen(utf8);
}

function libraryItem(value: Buffer): Result<ParsedLibraryItem | null, ServerError> {
    const parsed = parse(value).andThen((item) =>
        bytes(item, 2)
            .andThen(parse)
            .map((details) => ({ item, details }))
    );
    const visibility = parsed.andThen(({ item, details }) =>
        visibleInLibrary(details).map((visible) => ({ item, details, visible }))
    );

    return visibility.andThen(({ item, details, visible }) => {
        if (!visible) {
            return itemMediaKey(item).map((mediaKey): ParsedLibraryItem | null =>
                mediaKey ? { hiddenMediaKey: mediaKey } : null
            );
        }

        return libraryMetadata(item, details).map(
            ({ fingerprint, size, at, mediaKey, fileName }): ParsedLibraryItem | null => {
                const sha1 = fingerprint.toString('hex');
                if (
                    !Sha1HexSchema.safeParse(sha1).success ||
                    !mediaKey ||
                    !Number.isSafeInteger(at) ||
                    size < BMP_HEADER_BYTES ||
                    size > MAX_PHOTOS_BMP_BYTES
                )
                    return null;

                return { candidate: { size, at, mediaKey, sha1, fileName } };
            }
        );
    });
}

function visibleInLibrary(details: Field[]): Result<boolean, ServerError> {
    const trashed = optional(details, 16);
    if (!trashed || typeof trashed.value === 'number') return Ok(true);

    return parse(trashed.value).map((state) => !optional(state, 3)?.value);
}

function libraryMetadata(
    item: Field[],
    details: Field[]
): Result<
    {
        fingerprint: Buffer;
        size: number;
        at: number;
        mediaKey: string;
        fileName?: string;
    },
    ServerError
> {
    const fingerprint = bytes(details, 13).andThen((data) => nested(data, 1));
    const sized = fingerprint.andThen((fingerprint) =>
        integer(details, 10).map((size) => ({ fingerprint, size }))
    );
    const dated = sized.andThen((metadata) =>
        integer(details, 9).map((at) => ({ ...metadata, at }))
    );

    return dated.andThen((metadata) =>
        bytes(item, 1)
            .andThen(utf8)
            .map((mediaKey) => ({ ...metadata, mediaKey, ...fileName(details) }))
    );
}

function fileName(details: Field[]): { fileName?: string } {
    const field = optional(details, 4);
    if (!field || typeof field.value === 'number') return {};

    return utf8(field.value).match({
        Ok: (value) => (value ? { fileName: value } : {}),
        Err: () => ({})
    });
}

export type ParsedLibraryPage = {
    items: LibraryCandidate[];
    hiddenMediaKeys: string[];
    nextPageToken: string;
    syncToken?: Buffer;
    deletedMediaKeys: string[];
};

function deletionMediaKey(value: Buffer): Result<string | null, ServerError> {
    const item = parse(value)
        .andThen((fields) => bytes(fields, 1))
        .andThen(parse);

    return item.andThen((fields) =>
        integer(fields, 1).andThen((type) => {
            if (type !== 1) return Ok<string | null>(null);

            return bytes(fields, 2)
                .andThen((inner) => nested(inner, 1))
                .andThen(utf8)
                .map((mediaKey) => mediaKey || null);
        })
    );
}

export function parseLibraryPage(data: Buffer): Result<ParsedLibraryPage, ServerError> {
    return parse(data)
        .andThen((fields) => bytes(fields, 1))
        .andThen(parse)
        .map((fields) => {
            const items: LibraryCandidate[] = [];
            const hiddenMediaKeys: string[] = [];
            const deletedMediaKeys: string[] = [];

            for (const entry of fields) {
                if (entry.number === 2 && typeof entry.value !== 'number') {
                    const parsed = libraryItem(entry.value);
                    parsed.inspect((item) => {
                        if (!item) return;
                        if ('hiddenMediaKey' in item) hiddenMediaKeys.push(item.hiddenMediaKey);
                        else items.push(item.candidate);
                    });
                }

                if (entry.number === 9 && typeof entry.value !== 'number') {
                    const parsed = deletionMediaKey(entry.value);
                    parsed.inspect((mediaKey) => {
                        if (mediaKey) deletedMediaKeys.push(mediaKey);
                    });
                }
            }

            const next = optional(fields, 1);
            const sync = optional(fields, 6);

            return {
                items,
                hiddenMediaKeys,
                nextPageToken:
                    next && typeof next.value !== 'number' ? next.value.toString('base64url') : '',
                ...(sync && typeof sync.value !== 'number' && sync.value.length
                    ? { syncToken: sync.value }
                    : {}),
                deletedMediaKeys
            };
        });
}
