import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { runSpike } from '../../../scripts/google-share-spike/cli.ts';
import type { Ledger } from '../../../scripts/google-share-spike/ledger.ts';
import { FakeGoogle } from '../helpers/google-share-fake';
import { listingAnswer } from '../helpers/google-share-fake-public';
import { TEST_ACCOUNT } from '../helpers/upload';

let directory: string;
let ledgerPath: string;
let credentialsPath: string;

beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'phodrive-spike-integrity-'));
    ledgerPath = join(directory, 'ledger.json');
    credentialsPath = join(directory, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify(TEST_ACCOUNT));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run(google: FakeGoogle, command: string): Promise<number> {
    return runSpike([command, '--ledger', ledgerPath, '--credentials', credentialsPath], {
        fetcher: google.fetcher,
        write: () => undefined,
        sleep: async () => undefined
    });
}

function ledger(): Ledger {
    return JSON.parse(readFileSync(ledgerPath, 'utf8'));
}

test('missing direct URL observations remain unresolved after teardown completes', async () => {
    const google = new FakeGoogle({ responseNextToken: 7 });

    expect(await run(google, 'create')).toBe(0);
    expect(await run(google, 'revoke')).toBe(1);
    expect(ledger().directUrls).toEqual([]);
    expect(ledger().link.disable).toBe('ok');
    expect(ledger().envelope.remove).toBe('ok');
    expect(ledger().album.remove).toBe('ok');
});

test.each(['present', 'unavailable'])(
    'final media lookup %s prevents clean cleanup',
    async (state) => {
        let mutations = 0;
        const keys = new Map<string, string>();
        const google = new FakeGoogle({
            onCall: (route) => {
                if (route === 'mutation') mutations += 1;
            },
            preexisting: (sha1) => (mutations === 2 ? keys.get(sha1) : undefined),
            override: (route) =>
                route === 'hash' && mutations === 2 && state === 'unavailable'
                    ? new Response(null, { status: 503 })
                    : undefined
        });

        expect(await run(google, 'create')).toBe(0);
        for (const [sha1, media] of google.media) keys.set(sha1, media.key);

        expect(await run(google, 'cleanup')).toBe(1);
        expect(ledger().fixtures.map(({ presence }) => presence)).toEqual(
            Array(3).fill(state === 'present' ? 'present' : 'unknown')
        );
        expect(mutations).toBe(2);
    }
);

test('absent media reconciles an uncertain delete without resending it', async () => {
    let mutations = 0;
    const google = new FakeGoogle({
        onCall: (route) => {
            if (route === 'mutation') mutations += 1;
        },
        override: (route) =>
            route === 'mutation' && mutations === 2
                ? new Response(null, { status: 503 })
                : undefined
    });

    expect(await run(google, 'create')).toBe(0);
    expect(await run(google, 'cleanup')).toBe(0);
    expect(ledger().fixtures.map(({ remove }) => remove)).toEqual(['ok', 'ok', 'ok']);
    expect(await run(google, 'cleanup')).toBe(0);
    expect(mutations).toBe(2);
});

test('distinct public IDs cannot substitute duplicate bytes for missing fixtures', async () => {
    let duplicateSha1 = '';
    const google: FakeGoogle = new FakeGoogle({
        override: (route) =>
            route === 'batch'
                ? listingAnswer(
                      [...google.media.values()].map((media) => ({
                          ...media,
                          sha1: duplicateSha1
                      })),
                      null
                  )
                : undefined
    });

    expect(await run(google, 'create')).toBe(0);
    const [first] = [...google.media];
    duplicateSha1 = first[0];
    for (const media of google.media.values()) media.body = first[1].body;

    expect(await run(google, 'probe')).toBe(1);
});

test('unrecognised teardown receipts remain uncertain and cannot be retried', async () => {
    let teardown = false;
    const google = new FakeGoogle({
        override: (route) =>
            teardown && ['link', 'envelope-delete', 'album-remove'].includes(route)
                ? new Response('<html>not a receipt</html>')
                : undefined
    });

    expect(await run(google, 'create')).toBe(0);
    expect(await run(google, 'probe')).toBe(0);
    teardown = true;
    expect(await run(google, 'revoke')).toBe(1);
    expect(ledger().link.disable).toBe('uncertain');
    expect(ledger().envelope.remove).toBe('uncertain');
    expect(ledger().album.remove).toBe('uncertain');
    google.routes.length = 0;

    expect(await run(google, 'revoke')).toBe(1);
    expect(google.routes).not.toContain('link');
    expect(google.routes).not.toContain('envelope-delete');
    expect(google.routes).not.toContain('album-remove');
});
