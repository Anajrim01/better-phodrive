import { expect, test } from 'vitest';
import {
    assignOwners,
    deleteRoute,
    downloadRoute,
    GroupsSchema,
    mergeGroupLibrary,
    ownerRoute,
    StoredGroupsSchema,
    type AssignmentFile,
    type RouteMember
} from '@madkarmaa/phodrive-core/groups';
import { GroupSchema, type RemoteBmp } from '@madkarmaa/phodrive-core/models';

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';
const THIRD = 'third@example.com';

function file(name: string, size: number, fileId = 'a'.repeat(64)): AssignmentFile {
    return { fileId, name, size };
}

function chunk(overrides: Partial<RemoteBmp> = {}): RemoteBmp {
    return {
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'file.bin',
        size: 4,
        at: 1,
        mediaKey: 'media-1',
        sha1: 'c'.repeat(40),
        ...overrides
    };
}

function ownersById(assignments: ReturnType<typeof assignOwners>): Map<string, string | null> {
    return new Map(assignments.map(({ fileId, owner }) => [fileId, owner]));
}

function members(...emails: string[]): RouteMember[] {
    return emails.map((email) => ({ email, token: `aas_et/${email}`, paused: false }));
}

test('a group keeps a trimmed name and a unique account list', () => {
    const parsed = GroupSchema.parse({
        id: 'group-1',
        name: '  Family  ',
        accounts: [FIRST, SECOND]
    });

    expect(parsed).toEqual({ id: 'group-1', name: 'Family', accounts: [FIRST, SECOND] });
    expect(
        GroupSchema.parse({
            id: 'group-1',
            name: 'Family',
            accounts: ['First@Example.com']
        }).accounts
    ).toEqual([FIRST]);
    expect(
        GroupSchema.safeParse({
            id: 'group-1',
            name: 'Family',
            accounts: [FIRST, FIRST.toUpperCase()]
        }).success
    ).toBe(false);
    expect(GroupsSchema.safeParse([parsed, parsed]).success).toBe(false);
    expect(
        GroupSchema.safeParse({ id: 'group-1', name: 'Family', accounts: [FIRST, FIRST] }).success
    ).toBe(false);
    expect(GroupSchema.safeParse({ id: 'group-1', name: '', accounts: [FIRST] }).success).toBe(
        false
    );
    expect(GroupSchema.safeParse({ id: 'group-1', name: 'Family', accounts: [] }).success).toBe(
        false
    );
    expect(
        GroupSchema.safeParse({ id: 'group-1', name: 'Family', accounts: ['not-an-email'] }).success
    ).toBe(false);
});

test('stored groups tolerate a missing field and drop unusable entries', () => {
    expect(StoredGroupsSchema.parse(undefined)).toEqual([]);
    expect(StoredGroupsSchema.parse(null)).toEqual([]);
    expect(StoredGroupsSchema.parse({})).toEqual([]);

    expect(
        StoredGroupsSchema.parse([
            { id: 'group-1', name: 'Family', accounts: [FIRST] },
            { id: 'group-1', name: 'Duplicate id', accounts: [SECOND] },
            { id: 'group-2', name: 'Broken', accounts: ['not-an-email'] },
            { id: 'group-3', name: 'Friends', accounts: [SECOND, THIRD] }
        ])
    ).toEqual([
        { id: 'group-1', name: 'Family', accounts: [FIRST] },
        { id: 'group-3', name: 'Friends', accounts: [SECOND, THIRD] }
    ]);
});

test('assignment is deterministic and independent of file order', () => {
    const files = [
        file('one.bin', 4_000, '1'.repeat(64)),
        file('two.bin', 2_000, '2'.repeat(64)),
        file('three.bin', 1_000, '3'.repeat(64)),
        file('four.bin', 1_000, '4'.repeat(64))
    ];
    const group = [
        { email: FIRST, paused: false },
        { email: SECOND, paused: false }
    ];

    const first = assignOwners(files, group);
    const second = assignOwners(files.toReversed(), group);

    expect(assignOwners(files, group)).toEqual(first);
    expect(ownersById(second)).toEqual(ownersById(first));
});

test('a group without available members leaves every file unassigned', () => {
    const files = [file('one.bin', 4_000), file('two.bin', 1_000, 'b'.repeat(64))];
    const waiting = [
        { fileId: 'a'.repeat(64), owner: null },
        { fileId: 'b'.repeat(64), owner: null }
    ];

    expect(assignOwners(files, [])).toEqual(waiting);
});

test('all members paused leaves every file unassigned', () => {
    const files = [file('one.bin', 4_000), file('two.bin', 1_000, 'b'.repeat(64))];

    expect(
        assignOwners(files, [
            { email: FIRST, paused: true },
            { email: SECOND, paused: true }
        ])
    ).toEqual([
        { fileId: 'a'.repeat(64), owner: null },
        { fileId: 'b'.repeat(64), owner: null }
    ]);
});

test('a single available member owns every file', () => {
    const files = [file('one.bin', 4_000), file('two.bin', 1, 'b'.repeat(64))];

    expect(assignOwners(files, [{ email: FIRST, paused: false }])).toEqual([
        { fileId: 'a'.repeat(64), owner: FIRST },
        { fileId: 'b'.repeat(64), owner: FIRST }
    ]);
});

test('a paused member takes no files while the others keep receiving', () => {
    const files = [file('one.bin', 8_000), file('two.bin', 2_000, 'b'.repeat(64))];

    expect(
        assignOwners(files, [
            { email: FIRST, paused: true },
            { email: SECOND, paused: false },
            { email: THIRD, paused: false }
        ])
    ).toEqual([
        { fileId: 'a'.repeat(64), owner: SECOND },
        { fileId: 'b'.repeat(64), owner: THIRD }
    ]);
});

test('very uneven files are balanced by bytes instead of file count', () => {
    const files = [
        file('huge.bin', 100 * 1024 * 1024),
        file('small-a.bin', 1024, 'b'.repeat(64)),
        file('small-b.bin', 1024, 'c'.repeat(64))
    ];

    expect(
        assignOwners(files, [
            { email: FIRST, paused: false },
            { email: SECOND, paused: false }
        ])
    ).toEqual([
        { fileId: 'a'.repeat(64), owner: FIRST },
        { fileId: 'b'.repeat(64), owner: SECOND },
        { fileId: 'c'.repeat(64), owner: SECOND }
    ]);
});

test('a paused account keeps the rest of the listing and reports its own state', () => {
    const merged = mergeGroupLibrary([
        { email: FIRST, items: [chunk()] },
        {
            email: SECOND,
            error: {
                code: 'THROTTLED',
                message: 'Google Photos is limiting requests.',
                retryAfterSeconds: 30
            }
        }
    ]);

    expect(merged.items).toEqual([{ ...chunk(), email: FIRST }]);
    expect(merged.accounts).toEqual([
        { email: FIRST, status: 'ok' },
        {
            email: SECOND,
            status: 'paused',
            retryAfterSeconds: 30,
            message: 'Google Photos is limiting requests.'
        }
    ]);
    expect(merged.partial).toBe(true);
});

test('a paused member that is skipped still marks the result partial', () => {
    const merged = mergeGroupLibrary([
        { email: FIRST, items: [chunk()] },
        { email: SECOND, paused: true }
    ]);

    expect(merged.items).toHaveLength(1);
    expect(merged.accounts).toContainEqual({ email: SECOND, status: 'paused' });
    expect(merged.partial).toBe(true);
});

test('several pages from one account produce one state row and keep their items', () => {
    const merged = mergeGroupLibrary([
        { email: SECOND, items: [chunk({ mediaKey: 'second-1', at: 2 })] },
        { email: FIRST, items: [chunk({ mediaKey: 'first-1', at: 1 })] },
        { email: FIRST, items: [chunk({ mediaKey: 'first-2', at: 3 })], paused: true }
    ]);

    expect(merged.items.map((item) => item.mediaKey)).toEqual(['first-2', 'second-1', 'first-1']);
    expect(merged.accounts).toEqual([
        { email: FIRST, status: 'paused' },
        { email: SECOND, status: 'ok' }
    ]);
    expect(merged.partial).toBe(true);
});

test('a failed account is reported as an error rather than failing the merge', () => {
    const merged = mergeGroupLibrary([
        { email: FIRST, items: [chunk()] },
        { email: SECOND, error: { code: 'REQUEST_FAILED', message: 'Could not load files.' } }
    ]);

    expect(merged.items).toHaveLength(1);
    expect(merged.accounts).toContainEqual({
        email: SECOND,
        status: 'error',
        message: 'Could not load files.'
    });
    expect(merged.partial).toBe(true);
});

test('duplicate media keys merge by chunk index and keep one owner', () => {
    const merged = mergeGroupLibrary([
        { email: FIRST, items: [chunk({ at: 5 }), chunk({ chunkIndex: 1, isLast: true, at: 5 })] },
        { email: SECOND, items: [chunk({ at: 5 }), chunk({ chunkIndex: 1, isLast: true, at: 5 })] }
    ]);

    expect(merged.items).toEqual([
        { ...chunk({ at: 5 }), email: FIRST },
        { ...chunk({ chunkIndex: 1, isLast: true, at: 5 }), email: FIRST }
    ]);
    expect(merged.partial).toBe(false);
});

test('the merged listing sorts newest first across accounts with a stable tie break', () => {
    const merged = mergeGroupLibrary([
        {
            email: SECOND,
            items: [
                chunk({ mediaKey: 'second-old', at: 10 }),
                chunk({ mediaKey: 'second-new', at: 30 })
            ]
        },
        {
            email: FIRST,
            items: [
                chunk({ mediaKey: 'first-middle', at: 20 }),
                chunk({ mediaKey: 'first-tie', at: 20 })
            ]
        }
    ]);

    expect(merged.items.map((item) => item.mediaKey)).toEqual([
        'second-new',
        'first-middle',
        'first-tie',
        'second-old'
    ]);
});

test('a download and a delete always resolve to the owner', () => {
    const group = members(FIRST, SECOND, THIRD);

    const download = downloadRoute({ email: SECOND }, group);
    const remove = deleteRoute({ email: FIRST }, group);

    expect(download.unwrap()).toEqual({ email: SECOND, token: `aas_et/${SECOND}` });
    expect(remove.unwrap()).toEqual({ email: FIRST, token: `aas_et/${FIRST}` });
});

test('another member being paused does not divert a file from its owner', () => {
    const group: RouteMember[] = [
        { email: FIRST, token: `aas_et/${FIRST}`, paused: true },
        { email: SECOND, token: `aas_et/${SECOND}`, paused: false }
    ];

    const download = downloadRoute({ email: SECOND }, group).unwrap();
    const remove = deleteRoute({ email: SECOND }, group).unwrap();

    expect(download).toEqual({ email: SECOND, token: `aas_et/${SECOND}` });
    expect(remove).toEqual({ email: SECOND, token: `aas_et/${SECOND}` });
});

test('a paused owner keeps the route and never falls back to another member', () => {
    const group: RouteMember[] = [
        { email: FIRST, token: `aas_et/${FIRST}`, paused: false },
        { email: SECOND, token: `aas_et/${SECOND}`, paused: true }
    ];

    const owner = ownerRoute(SECOND, group).unwrap();
    expect(owner).toEqual({ email: SECOND, token: `aas_et/${SECOND}`, paused: true });

    for (const routed of [
        downloadRoute({ email: SECOND }, group),
        deleteRoute({ email: SECOND }, group)
    ]) {
        expect(routed.isErr()).toBe(true);
        if (routed.isErr()) {
            expect(routed.unwrapErr()).toMatchObject({ code: 'OWNER_PAUSED' });
            expect(routed.unwrapErr().message).toContain(SECOND);
            expect(routed.unwrapErr().message).not.toContain(FIRST);
        }
    }
});

test('a file whose owner left the group is unavailable', () => {
    const routed = downloadRoute({ email: THIRD }, members(FIRST, SECOND));

    expect(routed.isErr()).toBe(true);
    if (routed.isErr()) expect(routed.unwrapErr()).toMatchObject({ code: 'OWNER_NOT_IN_GROUP' });
});
