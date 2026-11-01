import type { ServerError } from '../../errors';
import { Ok, type Result } from 'results-ts';
import { LIBRARY_PAGE_REQUEST, LIBRARY_STATE_REQUEST } from './requests';
import { bytes, parse, encodeFields, type Field } from '../../protobuf';

export { parseLibraryPage, type LibraryCandidate, type ParsedLibraryPage } from './metadata-page';

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
