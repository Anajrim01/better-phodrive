import type { ServerError } from '../../errors';
import { Ok, type Result } from 'results-ts';
import { Sha1HexSchema } from '../../../models';
import { MAX_PHOTOS_BMP_BYTES, BMP_HEADER_BYTES } from '../../bmp/index';
import { bytes, parse, nested, integer, utf8, optional, type Field } from '../../protobuf';

export type LibraryCandidate = {
    size: number;
    at: number;
    mediaKey: string;
    sha1: string;
    fileName?: string;
    trashed: boolean;
};

type ParsedLibraryItem = { candidate: LibraryCandidate } | { hiddenMediaKey: string };

function itemMediaKey(item: Field[]): Result<string, ServerError> {
    return bytes(item, 1).andThen(utf8);
}

function candidateFrom(
    metadata: {
        fingerprint: Buffer;
        size: number;
        at: number;
        mediaKey: string;
        fileName?: string;
    },
    trashed: boolean
): ParsedLibraryItem | null {
    const sha1 = metadata.fingerprint.toString('hex');
    if (
        !Sha1HexSchema.safeParse(sha1).success ||
        !metadata.mediaKey ||
        !Number.isSafeInteger(metadata.at) ||
        metadata.size < BMP_HEADER_BYTES ||
        metadata.size > MAX_PHOTOS_BMP_BYTES
    )
        return null;

    return {
        candidate: {
            size: metadata.size,
            at: metadata.at,
            mediaKey: metadata.mediaKey,
            sha1,
            fileName: metadata.fileName,
            trashed
        }
    };
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

    return visibility.andThen<ParsedLibraryItem | null, ServerError>(
        ({ item, details, visible }) => {
            const metadata = libraryMetadata(item, details);
            if (metadata.isOk()) {
                const candidate = candidateFrom(metadata.unwrap(), !visible);
                if (candidate) return Ok(candidate);
            }
            if (visible) return Ok(null);

            return itemMediaKey(item).map((mediaKey) =>
                mediaKey ? { hiddenMediaKey: mediaKey } : null
            );
        }
    );
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
