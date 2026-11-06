import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { runSpike } from '../../../scripts/google-share-spike/cli.ts';
import type { Ledger } from '../../../scripts/google-share-spike/ledger.ts';
import { FakeGoogle, type FakeOptions } from '../helpers/google-share-fake';
import { SECRETS } from '../helpers/google-share-fake-secrets';
import { TEST_ACCOUNT } from '../helpers/upload';

const OWNER_ROUTES = new Set(['auth', 'album-create', 'envelope-create', 'link', 'mutation']);

let directory: string;
let ledgerPath: string;
let credentialsPath: string;
let output: string[];

beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'phodrive-share-spike-'));
    ledgerPath = join(directory, 'ledger.json');
    credentialsPath = join(directory, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify(TEST_ACCOUNT));
    output = [];
});

afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
});

function run(google: FakeGoogle, ...args: string[]): Promise<number> {
    const withCredentials = args[0] === 'probe' ? [] : ['--credentials', credentialsPath];

    return runSpike([...args, '--ledger', ledgerPath, ...withCredentials], {
        fetcher: google.fetcher,
        write: (line) => output.push(line),
        sleep: async () => undefined
    });
}

function ledger(): Ledger {
    return JSON.parse(readFileSync(ledgerPath, 'utf8'));
}

function lines(): { stage: string; status: string }[] {
    return output.map((line) => JSON.parse(line));
}

function stageStatus(stage: string): string[] {
    return lines()
        .filter((line) => line.stage === stage)
        .map((line) => line.status);
}

function fail(failing: string, status = 503): NonNullable<FakeOptions['override']> {
    return (route) => (route === failing ? new Response(null, { status }) : undefined);
}

test('create, probe, revoke and cleanup leave a fully resolved ledger and clean exit', async () => {
    const google = new FakeGoogle();

    expect(await run(google, 'create')).toBe(0);
    expect(ledger().fixtures.map(({ upload }) => upload)).toEqual(['ok', 'ok', 'ok']);
    expect(ledger().link.canonicalUrl).toContain(SECRETS.uid);

    expect(await run(google, 'probe')).toBe(0);
    expect(stageStatus('sha1-map')).toEqual(['matched', 'matched', 'matched']);
    expect(stageStatus('range-full')).toEqual(['exact', 'exact', 'exact']);
    expect(stageStatus('range-interior')).toEqual(['exact', 'exact', 'exact']);
    expect(stageStatus('dedup-slot')).toEqual(['found:3', 'found:3', 'found:3']);
    expect(stageStatus('pagination')).toEqual(['unobserved']);
    expect(stageStatus('cors-origin')).toEqual(['*', '*', '*']);
    expect(stageStatus('cors-preflight')).toEqual(['204:*', '204:*', '204:*']);
    expect(ledger().directUrls).toHaveLength(3);

    expect(await run(google, 'revoke')).toBe(0);
    expect(stageStatus('after-disable-album')).toEqual(['stopped']);
    expect(ledger().link.disable).toBe('ok');
    expect(ledger().album.remove).toBe('ok');
    expect(ledger().envelope.remove).toBe('ok');
    expect(google.albumExists).toBe(false);
    expect(google.media.size).toBe(3);

    expect(await run(google, 'cleanup')).toBe(0);
    expect(google.media.size).toBe(0);
    expect(ledger().fixtures.map(({ remove }) => remove)).toEqual(['ok', 'ok', 'ok']);
    expect(stageStatus('media-residue')).toEqual(['clear']);
});

test('every RPC finds its fixtures and intent already durable in the ledger', async () => {
    const seen: { route: string; ledger: Ledger }[] = [];
    const google = new FakeGoogle({
        onCall: (route) => seen.push({ route, ledger: ledger() })
    });

    expect(await run(google, 'create')).toBe(0);
    expect(seen[0].ledger.fixtures).toHaveLength(3);
    expect(seen.every(({ ledger: saved }) => saved.fixtures.every(({ sha1 }) => sha1))).toBe(true);

    const pendingAt = (route: string) => seen.find((call) => call.route === route)?.ledger;
    expect(pendingAt('commit')?.fixtures[0].upload).toBe('pending');
    expect(pendingAt('album-create')?.album.create).toBe('pending');
    expect(pendingAt('envelope-create')?.envelope.create).toBe('pending');
    expect(pendingAt('link')?.link.enable).toBe('pending');
    expect(pendingAt('album-create')?.fixtures.every(({ mediaKey }) => mediaKey)).toBe(true);
    expect(pendingAt('envelope-create')?.album.key).toBe(SECRETS.album);
    expect(pendingAt('link')?.envelope.key).toBe(SECRETS.envelope);
});

test('probe needs no credentials and only reaches public hosts', async () => {
    const google = new FakeGoogle();
    await run(google, 'create');
    google.calls.length = 0;
    google.routes.length = 0;

    expect(await run(google, 'probe')).toBe(0);
    expect(google.routes.filter((route) => OWNER_ROUTES.has(route))).toEqual([]);

    for (const { headers } of google.calls) {
        expect(headers.has('authorization')).toBe(false);
        expect(headers.has('cookie')).toBe(false);
    }
});

test('output never contains credentials, capabilities or keys', async () => {
    const google = new FakeGoogle();
    await run(google, 'create');
    await run(google, 'probe');
    await run(google, 'cleanup');

    const printed = output.join('\n');
    const forbidden = [TEST_ACCOUNT.email, TEST_ACCOUNT.token, ...Object.values(SECRETS)];

    for (const value of forbidden) expect(printed).not.toContain(value);
    for (const line of lines())
        for (const field of Object.keys(line))
            expect(['stage', 'status', 'count', 'hash', 'host']).toContain(field);
});

test('create refuses an existing ledger before any RPC', async () => {
    writeFileSync(ledgerPath, 'keep me');
    const google = new FakeGoogle();

    expect(await run(google, 'create')).toBe(1);
    expect(stageStatus('create')).toEqual(['LEDGER_CREATE_FAILED']);
    expect(google.calls).toEqual([]);
    expect(readFileSync(ledgerPath, 'utf8')).toBe('keep me');
});

test('an ambiguous enable is recorded, never retried, and cleanup still disables it', async () => {
    const google = new FakeGoogle({ override: fail('link') });

    expect(await run(google, 'create')).toBe(1);
    expect(google.routes.filter((route) => route === 'link')).toHaveLength(1);
    expect(ledger().link.enable).toBe('uncertain');
    expect(ledger().link.shortUrl).toBeUndefined();

    const cleanup = new FakeGoogle();
    cleanup.media = google.media;
    expect(await run(cleanup, 'cleanup')).toBe(1);
    expect(cleanup.routes.filter((route) => route === 'link')).toHaveLength(1);
    expect(ledger().link.disable).toBe('ok');
    expect(ledger().link.enable).toBe('uncertain');
});

test('cleanup never re-sends a removal whose first outcome was ambiguous', async () => {
    const google = new FakeGoogle();
    await run(google, 'create');

    const failing = new FakeGoogle({ override: fail('album-remove') });
    failing.media = google.media;
    failing.linkOn = true;
    expect(await run(failing, 'revoke')).toBe(1);
    expect(ledger().album.remove).toBe('uncertain');
    expect(stageStatus('share-residue')).toEqual(['unresolved']);

    const again = new FakeGoogle();
    again.media = google.media;
    expect(await run(again, 'cleanup')).toBe(1);
    expect(again.routes).not.toContain('album-remove');
    expect(ledger().album.remove).toBe('uncertain');
});

test('an album whose creation is ambiguous has no key to touch and stays as residue', async () => {
    const google = new FakeGoogle({
        override: (route) => (route === 'album-create' ? new Response('garbage') : undefined)
    });

    expect(await run(google, 'create')).toBe(1);
    expect(google.routes).not.toContain('envelope-create');
    expect(ledger().album).toMatchObject({ create: 'uncertain' });
    expect(ledger().album.key).toBeUndefined();

    const cleanup = new FakeGoogle();
    cleanup.media = google.media;
    expect(await run(cleanup, 'cleanup')).toBe(1);
    expect(cleanup.routes).not.toContain('album-remove');
    expect(cleanup.media.size).toBe(0);
    expect(stageStatus('share-residue').at(-1)).toBe('unresolved');
});

test('an uncertain upload is resolved by read-only hash lookup, not by re-uploading', async () => {
    const google = new FakeGoogle({ override: fail('commit') });

    expect(await run(google, 'create')).toBe(1);
    expect(google.routes.filter((route) => route === 'commit')).toHaveLength(1);
    expect(ledger().fixtures[0]).toMatchObject({ upload: 'uncertain' });
    expect(ledger().fixtures[1]).toMatchObject({ upload: 'none' });

    const cleanup = new FakeGoogle();
    cleanup.media = google.media;
    expect(await run(cleanup, 'cleanup')).toBe(0);
    expect(cleanup.routes).not.toContain('commit');
    expect(ledger().fixtures[0]).toMatchObject({ upload: 'ok', remove: 'ok' });
    expect(cleanup.media.size).toBe(0);
});

test('existing account media is never claimed or deleted', async () => {
    const existing = 'existingAccountMedia';
    const google = new FakeGoogle({ preexisting: () => existing });

    expect(await run(google, 'create')).toBe(1);
    expect(stageStatus('create')).toEqual(['FIXTURE_PREEXISTS']);
    expect(ledger().fixtures[0].upload).toBe('preexisting');
    expect(ledger().fixtures[0].mediaKey).toBeUndefined();

    const cleanup = new FakeGoogle({ preexisting: () => existing });
    expect(await run(cleanup, 'cleanup')).toBe(0);
    expect(cleanup.mutationTargets).toEqual([]);
    expect(cleanup.routes).not.toContain('hash');
});

test('a direct URL that outlives revocation is reported live and fails the run', async () => {
    const google = new FakeGoogle({ directOutlivesRevoke: true });
    await run(google, 'create');
    await run(google, 'probe');

    expect(await run(google, 'revoke')).toBe(1);
    expect(stageStatus('after-remove-direct')).toEqual(['live', 'live', 'live']);
    expect(stageStatus('after-remove-album')).toEqual(['stopped']);
    expect(stageStatus('share-residue')).toEqual(['clear']);
});

test('an unknown pagination slot fails clearly and reads no media', async () => {
    const google = new FakeGoogle({ responseNextToken: 7 });
    await run(google, 'create');
    google.routes.length = 0;

    expect(await run(google, 'probe')).toBe(1);
    expect(stageStatus('listing')).toEqual(['GOOGLE_LISTING_PAGINATION_UNKNOWN']);
    expect(google.routes).not.toContain('media');
});

test('a ledger from another account is refused before any RPC', async () => {
    const google = new FakeGoogle();
    await run(google, 'create');
    writeFileSync(credentialsPath, JSON.stringify({ ...TEST_ACCOUNT, email: 'other@example.com' }));
    google.calls.length = 0;

    expect(await run(google, 'cleanup')).toBe(1);
    expect(stageStatus('cleanup')).toEqual(['LEDGER_ACCOUNT_MISMATCH']);
    expect(google.calls).toEqual([]);
});

test('unreadable credentials are reported by code without quoting the file', async () => {
    writeFileSync(credentialsPath, `{"email":"${TEST_ACCOUNT.email}","token":`);
    const google = new FakeGoogle();

    expect(await run(google, 'create')).toBe(1);
    expect(stageStatus('create')).toEqual(['CREDENTIALS_INVALID']);
    expect(output.join('\n')).not.toContain(TEST_ACCOUNT.email);
    expect(google.calls).toEqual([]);
});

test.each([
    [['create', '--ledger', 'x']],
    [['probe']],
    [['unknown', '--ledger', 'x', '--credentials', 'y']],
    [['create', '--nope']],
    [[]]
])('invalid arguments %j print usage and make no request', async (args) => {
    const google = new FakeGoogle();
    const code = await runSpike(args, {
        fetcher: google.fetcher,
        write: (line) => output.push(line),
        sleep: async () => undefined
    });

    expect(code).toBe(2);
    expect(output[0]).toContain('Usage:');
    expect(google.calls).toEqual([]);
});
