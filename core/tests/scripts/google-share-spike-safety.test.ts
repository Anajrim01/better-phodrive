import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { runSpike } from '../../../scripts/google-share-spike/cli.ts';
import { FakeGoogle } from '../helpers/google-share-fake';
import { ALBUM_URL } from '../helpers/google-share-fake-secrets';
import { TEST_ACCOUNT } from '../helpers/upload';

let directory: string;
let ledgerPath: string;
let credentialsPath: string;
let output: string[];

beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'phodrive-spike-safety-'));
    ledgerPath = join(directory, 'ledger.json');
    credentialsPath = join(directory, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify(TEST_ACCOUNT));
    output = [];
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run(google: FakeGoogle, command: string): Promise<number> {
    return runSpike([command, '--ledger', ledgerPath, '--credentials', credentialsPath], {
        fetcher: google.fetcher,
        write: (line) => output.push(line),
        sleep: async () => undefined
    });
}

test.each(['revoke', 'cleanup'])(
    '%s stops after a mutation cannot be recorded',
    async (command) => {
        let failWrites = false;
        const google = new FakeGoogle({
            onCall: (route) => {
                if (failWrites && route === 'link') mkdirSync(`${ledgerPath}.tmp`);
            }
        });

        expect(await run(google, 'create')).toBe(0);
        expect(await run(google, 'probe')).toBe(0);
        failWrites = true;
        google.routes.length = 0;

        expect(await run(google, command)).toBe(1);
        expect(google.routes.filter((route) => route === 'link')).toHaveLength(1);
        expect(google.routes).not.toContain('envelope-delete');
        expect(google.routes).not.toContain('album-remove');
        expect(google.routes).not.toContain('mutation');
    }
);

test('a failed direct URL capture write prevents any revocation mutation', async () => {
    let failCapture = false;
    const google = new FakeGoogle({
        onCall: (route) => {
            if (failCapture && route === 'batch') mkdirSync(`${ledgerPath}.tmp`);
        }
    });

    expect(await run(google, 'create')).toBe(0);
    failCapture = true;
    google.routes.length = 0;

    expect(await run(google, 'revoke')).toBe(1);
    expect(google.routes).toContain('batch');
    expect(google.routes).not.toContain('link');
    expect(google.routes).not.toContain('envelope-delete');
    expect(google.routes).not.toContain('album-remove');
});

function stageStatus(stage: string): string[] {
    return output
        .map((line) => JSON.parse(line))
        .filter((line) => line.stage === stage)
        .map((line) => line.status);
}

test('unreachable public URLs cannot confirm revocation', async () => {
    const google = new FakeGoogle();
    expect(await run(google, 'create')).toBe(0);
    expect(await run(google, 'probe')).toBe(0);

    const unavailable = new FakeGoogle({
        override: (route) =>
            ['short', 'page', 'media'].includes(route)
                ? new Response(null, { status: 503 })
                : undefined
    });

    expect(await run(unavailable, 'revoke')).toBe(1);
    expect(stageStatus('after-remove-direct')).toEqual(['unknown', 'unknown', 'unknown']);
});

test.each([
    'https://lh3.googleusercontent.com/pw/redirected-fixture=d',
    'https://unverified.invalid/redirected-fixture'
])('a direct media redirect to %s cannot confirm revocation', async (location) => {
    const google = new FakeGoogle();
    expect(await run(google, 'create')).toBe(0);
    expect(await run(google, 'probe')).toBe(0);

    const redirected = new FakeGoogle({
        override: (route, call) => {
            if (route === 'media') expect(call.headers.has('authorization')).toBe(false);

            return route === 'media'
                ? new Response(null, { status: 302, headers: { location } })
                : undefined;
        }
    });

    expect(await run(redirected, 'revoke')).toBe(1);
    expect(stageStatus('after-remove-direct')).toEqual(['unknown', 'unknown', 'unknown']);
    expect(redirected.calls.some(({ url }) => url.href === location)).toBe(false);
});

test.each([true, false])(
    'short-link verification follows only its known album: %s',
    async (known) => {
        const google = new FakeGoogle();
        expect(await run(google, 'create')).toBe(0);
        expect(await run(google, 'probe')).toBe(0);
        const location = known ? ALBUM_URL : 'https://photos.google.com/share/other?key=other';
        const redirected = new FakeGoogle({
            override: (route) =>
                route === 'short'
                    ? new Response(null, { status: 302, headers: { location } })
                    : undefined
        });

        expect(await run(redirected, 'revoke')).toBe(known ? 0 : 1);
        expect(stageStatus('after-remove-short')).toEqual([known ? 'stopped' : 'unknown']);
        if (!known) expect(redirected.calls.some(({ url }) => url.href === location)).toBe(false);
    }
);
