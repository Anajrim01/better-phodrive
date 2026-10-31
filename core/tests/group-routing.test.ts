import { expect, test } from 'vitest';
import {
    deleteRoute,
    downloadRoute,
    ownerRoute,
    type RouteMember
} from '@madkarmaa/phodrive-core/groups';

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';
const THIRD = 'third@example.com';

function members(...emails: string[]): RouteMember[] {
    return emails.map((email) => ({ email, token: `aas_et/${email}`, paused: false }));
}

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

test('owner matching ignores email case', () => {
    const group: RouteMember[] = [
        { email: FIRST.toUpperCase(), token: `aas_et/${FIRST}`, paused: false }
    ];

    expect(ownerRoute(FIRST, group).unwrap().email).toBe(FIRST.toUpperCase());
    expect(downloadRoute({ email: FIRST.toUpperCase() }, group).unwrap().token).toBe(
        `aas_et/${FIRST}`
    );
});

test('a file whose owner left the group is unavailable', () => {
    const group = members(FIRST, SECOND);

    for (const routed of [
        downloadRoute({ email: THIRD }, group),
        deleteRoute({ email: THIRD }, group)
    ]) {
        expect(routed.isErr()).toBe(true);
        if (routed.isErr())
            expect(routed.unwrapErr()).toMatchObject({ code: 'OWNER_NOT_IN_GROUP' });
    }
});
