import { expect, test } from 'vitest';
import { assignUploadOwners, type AssignmentFile } from '@madkarmaa/phodrive-core/browser/upload';

const FIRST = { id: 'account-first' };
const SECOND = { id: 'account-second' };
const THIRD = { id: 'account-third' };

function file(jobId: number, name: string, size: number): AssignmentFile {
    return { jobId, name, size };
}

function owners(files: readonly AssignmentFile[], members: readonly { id: string }[]) {
    return new Map(
        assignUploadOwners(files, members).map(({ jobId, accountId }) => [jobId, accountId])
    );
}

test('assignment is deterministic and independent of file order', () => {
    const files = [
        file(0, 'huge.bin', 100_000),
        file(1, 'small.bin', 10),
        file(2, 'other.bin', 50)
    ];
    const reversed = [...files].reverse();

    expect(owners(files, [FIRST, SECOND])).toEqual(owners(reversed, [FIRST, SECOND]));
});

test('largest files go to the least-loaded member by batch bytes', () => {
    const files = [
        file(0, 'huge.bin', 100 * 1024 * 1024),
        file(1, 'small-a.bin', 1024),
        file(2, 'small-b.bin', 1024)
    ];

    expect(owners(files, [FIRST, SECOND])).toEqual(
        new Map([
            [0, FIRST.id],
            [1, SECOND.id],
            [2, SECOND.id]
        ])
    );
});

test('member order does not change assignment or tie-breaking', () => {
    const files = [file(0, 'a.bin', 100), file(1, 'b.bin', 100)];

    expect(owners(files, [SECOND, FIRST])).toEqual(owners(files, [FIRST, SECOND]));
});

test('equal sizes alternate and keep the earliest member on a tie', () => {
    const files = [file(0, 'a.bin', 100), file(1, 'b.bin', 100), file(2, 'c.bin', 10)];

    expect(owners(files, [FIRST, SECOND])).toEqual(
        new Map([
            [0, FIRST.id],
            [1, SECOND.id],
            [2, FIRST.id]
        ])
    );
});

test('one member receives every file', () => {
    const files = [file(0, 'a.bin', 10), file(1, 'b.bin', 20)];

    expect(owners(files, [FIRST])).toEqual(
        new Map([
            [0, FIRST.id],
            [1, FIRST.id]
        ])
    );
});

test('an empty member list leaves every file unassigned', () => {
    expect(owners([file(0, 'a.bin', 10)], [])).toEqual(new Map([[0, null]]));
});

test('zero-byte files join the least-loaded member without changing the load', () => {
    const files = [file(0, 'a.bin', 100), file(1, 'empty.bin', 0)];

    expect(owners(files, [FIRST, SECOND, THIRD])).toEqual(
        new Map([
            [0, FIRST.id],
            [1, SECOND.id]
        ])
    );
});
