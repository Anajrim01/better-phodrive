import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type Result } from 'results-ts';
import { parse, type Field } from '../protobuf';

const RESULT_KEY_FIELD = 1;
const RESULT_ITEM_FIELD = 2;
const RESULT_ITEM_ID_FIELD = 6;

function nonEmptyBytes(field: Field): field is Field & { value: Buffer } {
    return Buffer.isBuffer(field.value) && field.value.length > 0;
}

function identityMatches(field: Field, key: Buffer, id: Buffer): boolean {
    if (!Buffer.isBuffer(field.value)) return false;

    return parse(field.value).match({
        Ok: (fields) => {
            const itemKey = fields.find((entry) => entry.number === RESULT_KEY_FIELD);
            const itemId = fields.find((entry) => entry.number === RESULT_ITEM_FIELD);

            return (
                itemKey !== undefined &&
                itemId !== undefined &&
                nonEmptyBytes(itemKey) &&
                nonEmptyBytes(itemId) &&
                itemKey.value.equals(key) &&
                itemId.value.equals(id)
            );
        },
        Err: () => false
    });
}

function itemIdentityKey(field: Field): string | null {
    if (!Buffer.isBuffer(field.value)) return null;

    return parse(field.value).match({
        Ok: (fields) => {
            const key = fields.find((entry) => entry.number === RESULT_KEY_FIELD);
            const id = fields.find((entry) => entry.number === RESULT_ITEM_FIELD);
            const identity = fields.find((entry) => entry.number === RESULT_ITEM_ID_FIELD);

            if (key === undefined || id === undefined || identity === undefined) return null;
            if (!nonEmptyBytes(key) || !nonEmptyBytes(id)) return null;
            if (!identityMatches(identity, key.value, id.value)) return null;

            return key.value.toString('utf8');
        },
        Err: () => null
    });
}

export type DeleteResponseOptions = {
    allowAlreadyApplied?: boolean;
};

// Google omits field 1 for keys already in trash while still returning field 2.
export function validateDeleteResponse(
    body: Buffer,
    expected: ReadonlySet<string>,
    options: DeleteResponseOptions = {}
): Result<void, ServerError> {
    return parse(body)
        .mapErr(() => SERVER_ERRORS.INVALID_DELETE_RESPONSE)
        .andThen((fields) => {
            const keys: string[] = [];
            for (const field of fields) {
                if (field.number === RESULT_KEY_FIELD && nonEmptyBytes(field))
                    keys.push(field.value.toString('utf8'));
            }

            const uniqueKeys = new Set(keys);
            const items = fields.filter((field) => field.number === RESULT_ITEM_FIELD);
            const identities = items.map(itemIdentityKey);
            const knownKeys = [...uniqueKeys].every((key) => expected.has(key));
            const keysMatch = options.allowAlreadyApplied
                ? uniqueKeys.size === keys.length && knownKeys && uniqueKeys.size <= expected.size
                : uniqueKeys.size === keys.length && uniqueKeys.size === expected.size && knownKeys;
            const itemsMatch = items.length > 0 && identities.every((key) => key !== null);
            // Without field 1 keys, field 2 identifies the item already in trash. It must be
            // one we asked about, or a duplicate sha1 would report an active copy as deleted.
            const identitiesMatch =
                keys.length > 0 || identities.every((key) => key !== null && expected.has(key));

            if (!keysMatch || !itemsMatch || !identitiesMatch)
                return Err(SERVER_ERRORS.INVALID_DELETE_RESPONSE);

            return Ok(undefined);
        });
}
