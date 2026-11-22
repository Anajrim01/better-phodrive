import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type Result } from 'results-ts';
import { Sha1HexSchema, type LibraryWarning } from '../../../models';
import { isPossibleSplitBmpSize } from '../../bmp/index';
import { LIBRARY_PAGE_REQUEST } from './requests';
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

export function pageRequest(resume: Buffer): Result<Buffer, ServerError> {
    const envelope = parse(Buffer.from(LIBRARY_PAGE_REQUEST, 'base64')).andThen((fields) =>
        bytes(fields, 1)
            .andThen(parse)
            .map((outer) => ({ fields, outer }))
    );

    return envelope.map(({ fields, outer }) => {
        // The resume token belongs at 1.4; 1.1 contains the media metadata mask.
        const updatedOuter = outer.filter((field) => field.number !== 4);
        updatedOuter.push({ number: 4, value: resume });

        return encodeFields(
            fields.map((field) =>
                field.number === 1 ? { number: 1, value: encodeFields(updatedOuter) } : field
            )
        );
    });
}

export type LibraryCandidate = {
    size: number;
    at: number;
    mediaKey: string;
    sha1: string;
    trashed?: boolean;
};

/** The provider lists hidden items with only a key and their visibility state. */
function isKeyOnlyHidden(details: Field[], visible: boolean): boolean {
    return !visible && !optional(details, 13) && !optional(details, 10) && !optional(details, 9);
}

function libraryItem(value: Buffer): Result<LibraryCandidate | null, ServerError> {
    const parsed = parse(value).andThen((item) =>
        bytes(item, 2)
            .andThen(parse)
            .andThen((details) =>
                visibleInLibrary(details).map((visible) => ({ item, details, visible }))
            )
    );

    return parsed.andThen(({ item, details, visible }) => {
        if (isKeyOnlyHidden(details, visible)) return Ok(null);

        // A size that cannot be a split BMP proves the item is not Phodrive, even without a fingerprint.
        const listedSize = integer(details, 10);
        if (listedSize.isErr()) return Err(listedSize.unwrapErr());
        if (!isPossibleSplitBmpSize(listedSize.unwrap())) return Ok(null);

        return libraryMetadata(item, details).andThen(({ fingerprint, size, at, mediaKey }) => {
            const sha1 = fingerprint.toString('hex');
            if (!Sha1HexSchema.safeParse(sha1).success || !mediaKey || !Number.isSafeInteger(at))
                return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

            return Ok({
                size,
                at,
                mediaKey,
                sha1,
                ...(visible ? {} : { trashed: true })
            });
        });
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
): Result<{ fingerprint: Buffer; size: number; at: number; mediaKey: string }, ServerError> {
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
            .map((mediaKey) => ({ ...metadata, mediaKey }))
    );
}

export function parseLibraryPage(
    data: Buffer
): Result<
    { items: LibraryCandidate[]; nextPageToken: string; warnings: LibraryWarning[] },
    ServerError
> {
    return parse(data)
        .andThen((fields) => bytes(fields, 1))
        .andThen(parse)
        .map((fields) => {
            const items: LibraryCandidate[] = [];
            const failures: ServerError[] = [];

            for (const entry of fields) {
                if (entry.number !== 2 || typeof entry.value === 'number') continue;

                libraryItem(entry.value).match({
                    Ok: (item) => {
                        if (item) items.push(item);
                    },
                    Err: (error) => failures.push(error)
                });
            }

            const next = optional(fields, 1);
            const warnings: LibraryWarning[] = failures.length
                ? [{ code: 'ENTRY_PARSE_FAILED', count: failures.length }]
                : [];

            return {
                items,
                nextPageToken:
                    next && typeof next.value !== 'number' ? next.value.toString('base64url') : '',
                warnings
            };
        });
}
