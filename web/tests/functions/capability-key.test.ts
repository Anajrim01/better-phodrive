import { expect, test } from 'vitest';
import { handleBytes } from '../../functions/_lib/bytes';
import { validCapabilityKey as edgeAccepts } from '../../functions/_lib/capability';
import { validCapabilityKey as serverAccepts } from '../../../server/src/shares/capability';
import { capability, rangeResponse, request } from '../helpers/edge';

const KEY = Buffer.alloc(32, 7).toString('base64');
const MALFORMED: [string, string][] = [
    ['empty', ''],
    ['31 decoded bytes', Buffer.alloc(31, 7).toString('base64')],
    ['33 decoded bytes', Buffer.alloc(33, 7).toString('base64')],
    ['an invalid character appended', `${KEY}!`],
    ['garbage appended', `${KEY}AAAA`],
    ['a trailing newline', `${KEY}\n`],
    ['missing padding', KEY.slice(0, -1)],
    ['extra padding', `${KEY}=`],
    ['padding in the wrong place', `=${KEY.slice(0, -1)}`],
    ['non-canonical trailing bits', `${KEY.slice(0, 42)}B=`],
    ['the base64url alphabet', Buffer.alloc(32, 255).toString('base64url')]
];

test('the server and the edge accept a valid 32-byte key', () => {
    expect(serverAccepts(KEY)).toBe(true);
    expect(edgeAccepts(KEY)).toBe(true);
    expect(edgeAccepts(Buffer.alloc(32, 255).toString('base64'))).toBe(true);
});

test.each(MALFORMED)('the server and the edge both reject %s', (_name, key) => {
    expect(serverAccepts(key)).toBe(false);
    expect(edgeAccepts(key)).toBe(false);
});

test.each(MALFORMED.filter(([, key]) => key))(
    'an edge configured with %s reaches no upstream',
    async (_name, secret) => {
        let fetched = 0;
        const response = await handleBytes(request(await capability(), 'bytes=0-9'), {
            secret,
            fetch: async () => {
                fetched++;

                return rangeResponse(10);
            }
        });

        expect(response.ok).toBe(false);
        expect(fetched).toBe(0);
    }
);
