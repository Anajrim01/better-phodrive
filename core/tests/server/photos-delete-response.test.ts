import { expect, test } from 'vitest';
import { bytesField, message } from '@madkarmaa/phodrive-core/server/protobuf';
import { validateDeleteResponse } from '../../src/server/photos/delete-response';
import {
    CAPTURED_ALREADY_TRASHED,
    CAPTURED_ALREADY_TRASHED_KEY,
    CAPTURED_DELETE_KEY,
    CAPTURED_DELETE_SUCCESS
} from '../helpers/delete-response';

const TRASH = { allowAlreadyApplied: true };

test('the captured successful delete response validates', () => {
    expect(
        validateDeleteResponse(CAPTURED_DELETE_SUCCESS, new Set([CAPTURED_DELETE_KEY])).isOk()
    ).toBe(true);
    expect(
        validateDeleteResponse(
            CAPTURED_DELETE_SUCCESS,
            new Set([CAPTURED_DELETE_KEY]),
            TRASH
        ).isOk()
    ).toBe(true);
});

test('the captured already-trashed response validates for trash only', () => {
    expect(
        validateDeleteResponse(
            CAPTURED_ALREADY_TRASHED,
            new Set([CAPTURED_ALREADY_TRASHED_KEY]),
            TRASH
        ).isOk()
    ).toBe(true);
    expect(
        validateDeleteResponse(
            CAPTURED_ALREADY_TRASHED,
            new Set([CAPTURED_ALREADY_TRASHED_KEY])
        ).isErr()
    ).toBe(true);
});

test('an already-trashed response for a different media key is rejected', () => {
    expect(
        validateDeleteResponse(
            CAPTURED_ALREADY_TRASHED,
            new Set(['other-media-key']),
            TRASH
        ).isErr()
    ).toBe(true);
    expect(
        validateDeleteResponse(
            CAPTURED_ALREADY_TRASHED,
            new Set([CAPTURED_ALREADY_TRASHED_KEY, 'other-media-key']),
            TRASH
        ).isOk()
    ).toBe(true);
});

test('an already-applied response must echo one of the expected media keys', () => {
    const mediaKey = 'requested-media-key';
    const itemId = '2';
    const item = message(
        bytesField(1, mediaKey),
        bytesField(2, itemId),
        bytesField(6, message(bytesField(1, mediaKey), bytesField(2, itemId)))
    );
    const alreadyApplied = message(bytesField(2, item));

    expect(validateDeleteResponse(alreadyApplied, new Set([mediaKey]), TRASH).isOk()).toBe(true);
    expect(validateDeleteResponse(alreadyApplied, new Set(['other']), TRASH).isErr()).toBe(true);
});

test('trash accepts a subset of requested keys but rejects unknown keys', () => {
    const expected = new Set([CAPTURED_DELETE_KEY, 'other']);

    expect(validateDeleteResponse(CAPTURED_DELETE_SUCCESS, expected, TRASH).isOk()).toBe(true);
    expect(validateDeleteResponse(CAPTURED_DELETE_SUCCESS, new Set(['other']), TRASH).isErr()).toBe(
        true
    );
});

test('a malformed, empty, or invalid delete response is rejected', () => {
    const withoutItem = message(bytesField(1, 'key'));
    const withoutKey = message(bytesField(2, bytesField(1, 'item')));
    const malformedItem = Buffer.from([0x0a, 0x01, 0x78, 0x12, 0x01, 0xff]);

    expect(validateDeleteResponse(Buffer.from('malformed'), new Set(['key'])).isErr()).toBe(true);
    expect(validateDeleteResponse(Buffer.alloc(0), new Set(['key'])).isErr()).toBe(true);
    expect(validateDeleteResponse(withoutItem, new Set(['key'])).isErr()).toBe(true);
    expect(validateDeleteResponse(withoutKey, new Set(['key'])).isErr()).toBe(true);
    expect(validateDeleteResponse(malformedItem, new Set(['x'])).isErr()).toBe(true);
    expect(validateDeleteResponse(withoutItem, new Set(['key']), TRASH).isErr()).toBe(true);
    expect(validateDeleteResponse(withoutKey, new Set(['key']), TRASH).isErr()).toBe(true);
    expect(validateDeleteResponse(malformedItem, new Set(['x']), TRASH).isErr()).toBe(true);
    expect(validateDeleteResponse(CAPTURED_DELETE_SUCCESS, new Set(['other'])).isErr()).toBe(true);
    expect(
        validateDeleteResponse(
            CAPTURED_DELETE_SUCCESS,
            new Set([CAPTURED_DELETE_KEY, 'other'])
        ).isErr()
    ).toBe(true);
});

test('duplicate returned keys are rejected even when missing keys are allowed', () => {
    const itemKey = 'item-key';
    const itemId = '1';
    const validItem = message(
        bytesField(1, itemKey),
        bytesField(2, itemId),
        bytesField(6, message(bytesField(1, itemKey), bytesField(2, itemId)))
    );
    const duplicate = message(bytesField(1, 'key'), bytesField(1, 'key'), bytesField(2, validItem));

    expect(validateDeleteResponse(duplicate, new Set(['key']), TRASH).isErr()).toBe(true);
});

test('every returned item must be structurally valid', () => {
    const itemKey = 'item-key';
    const itemId = '1';
    const validItem = message(
        bytesField(1, itemKey),
        bytesField(2, itemId),
        bytesField(6, message(bytesField(1, itemKey), bytesField(2, itemId)))
    );
    const mixed = message(
        bytesField(1, 'key'),
        bytesField(2, validItem),
        bytesField(2, Buffer.from([0xff]))
    );

    expect(validateDeleteResponse(mixed, new Set(['key'])).isErr()).toBe(true);
    expect(validateDeleteResponse(mixed, new Set(['key']), TRASH).isErr()).toBe(true);
});
