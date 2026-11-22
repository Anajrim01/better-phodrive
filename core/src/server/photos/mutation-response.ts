import { Err, Ok, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { bytes, nested, optional, parse, utf8, type Field } from '../protobuf';

export type MutationKind = 'trash' | 'restore' | 'delete';

export type MutationReceipt = { applied: string[]; alreadyApplied: boolean };

function responseKeys(fields: Field[]): Result<string[], ServerError> {
    const keys: string[] = [];

    for (const field of fields) {
        if (field.number !== 1) continue;
        if (typeof field.value === 'number') return Err(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);

        const decoded = utf8(field.value);
        if (decoded.isErr() || !decoded.unwrap())
            return Err(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);
        keys.push(decoded.unwrap());
    }

    return Ok(keys);
}

function itemIdentity(value: Buffer): Result<string, ServerError> {
    return parse(value).andThen((fields) => {
        const identity = optional(fields, 6);
        const key =
            identity && typeof identity.value !== 'number'
                ? nested(identity.value, 1)
                : bytes(fields, 1);

        return key
            .andThen(utf8)
            .andThen((decoded) =>
                decoded ? Ok(decoded) : Err(SERVER_ERRORS.INVALID_MUTATION_RESPONSE)
            );
    });
}

/**
 * Validate one delete-result body. Trash accepts the captured already-trashed shape only when a
 * single requested item is the returned identity; restore and permanent delete require exact keys.
 */
export function validateMutationResponse(
    kind: MutationKind,
    body: Buffer,
    requested: readonly string[]
): Result<MutationReceipt, ServerError> {
    const expected = new Set(requested);
    if (!expected.size) return Err(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);

    return parse(body).andThen((fields): Result<MutationReceipt, ServerError> => {
        const parsedKeys = responseKeys(fields);
        if (parsedKeys.isErr()) return parsedKeys;

        const items: string[] = [];
        for (const field of fields) {
            if (field.number !== 2) continue;
            if (typeof field.value === 'number')
                return Err(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);

            const identity = itemIdentity(field.value);
            if (identity.isErr()) return identity;
            items.push(identity.unwrap());
        }

        const keys = parsedKeys.unwrap();
        if (!items.length || new Set(keys).size !== keys.length)
            return Err(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);
        if (keys.some((key) => !expected.has(key)))
            return Err(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);

        if (kind !== 'trash') {
            const exact =
                keys.length === requested.length && requested.every((key) => keys.includes(key));

            return exact
                ? Ok({ applied: keys, alreadyApplied: false })
                : Err(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);
        }

        if (keys.length) return Ok({ applied: keys, alreadyApplied: false });
        if (requested.length !== 1 || items.length !== 1)
            return Err(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);

        const identity = items[0]!;
        if (identity !== requested[0])
            return Err(
                expected.has(identity)
                    ? SERVER_ERRORS.INVALID_MUTATION_RESPONSE
                    : SERVER_ERRORS.DUPLICATE_IN_TRASH
            );

        return Ok({ applied: [identity], alreadyApplied: true });
    });
}
