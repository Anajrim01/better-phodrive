import { expect, test } from 'vitest';
import { bytesField, message } from '@madkarmaa/phodrive-core/server/protobuf';
import { validateDeleteResponse } from '../../src/server/photos/delete-response';

const CAPTURED_KEY = 'AF1QipNbE9JEAqIfVAY2Fc6tk_cRhEfjTxueqKDMEbyM';
const CAPTURED_SUCCESS = Buffer.from(
    '0a2c4146315169704e6245394a454171496656415932466336746b5f63526845666a54787565714b444d4562794d12f1010a204146315169704d6b4f496d4266676c3738736638374d43674351395a7a5059481215313137343935303434393439393338353234333837225468747470733a2f2f6c68332e676f6f676c6575736572636f6e74656e742e636f6d2f654f3055616a71666442785f73376d314b426e574d4970573946554b32716e3542774e725672714e3448735767516c45336732390a204146315169704d6b4f496d4266676c3738736638374d43674351395a7a5059481215313137343935303434393439393338353234333837422008a5d44c10808080803c180020002a02080132021802380040808080f70258019201020802',
    'hex'
);

test('the captured successful delete response validates', () => {
    expect(validateDeleteResponse(CAPTURED_SUCCESS, new Set([CAPTURED_KEY])).isOk()).toBe(true);
});

test('a malformed, empty, or partial delete response is rejected', () => {
    const withoutItem = message(bytesField(1, 'key'));
    const withoutKey = message(bytesField(2, bytesField(1, 'item')));
    const malformedItem = Buffer.from([0x0a, 0x01, 0x78, 0x12, 0x01, 0xff]);

    expect(validateDeleteResponse(Buffer.from('malformed'), new Set(['key'])).isErr()).toBe(true);
    expect(validateDeleteResponse(Buffer.alloc(0), new Set(['key'])).isErr()).toBe(true);
    expect(validateDeleteResponse(withoutItem, new Set(['key'])).isErr()).toBe(true);
    expect(validateDeleteResponse(withoutKey, new Set(['key'])).isErr()).toBe(true);
    expect(validateDeleteResponse(malformedItem, new Set(['x'])).isErr()).toBe(true);
    expect(validateDeleteResponse(CAPTURED_SUCCESS, new Set(['other'])).isErr()).toBe(true);
    expect(validateDeleteResponse(CAPTURED_SUCCESS, new Set([CAPTURED_KEY, 'other'])).isErr()).toBe(
        true
    );
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
});
