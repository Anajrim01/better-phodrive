import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { runSpike } from '../../../scripts/google-share-spike/cli.ts';
import type { Ledger } from '../../../scripts/google-share-spike/ledger.ts';
import { FakeGoogle } from '../helpers/google-share-fake';
import { TEST_ACCOUNT } from '../helpers/upload';

let directory: string;
let ledgerPath: string;
let credentialsPath: string;
let output: string[];

beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'phodrive-spike-count-'));
    ledgerPath = join(directory, 'ledger.json');
    credentialsPath = join(directory, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify(TEST_ACCOUNT));
    output = [];
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run(google: FakeGoogle, command: string, ...args: string[]): Promise<number> {
    return runSpike([command, '--ledger', ledgerPath, '--credentials', credentialsPath, ...args], {
        fetcher: google.fetcher,
        write: (line) => output.push(line),
        sleep: async () => undefined
    });
}

function ledger(): Ledger {
    return JSON.parse(readFileSync(ledgerPath, 'utf8'));
}

test.each([
    { args: [], count: 3 },
    { args: ['--count', '4'], count: 4 }
])(
    '$count fixtures are durable before upload and only owned media is cleaned',
    async ({ args, count }) => {
        const seen: { route: string; ledger: Ledger }[] = [];
        const google = new FakeGoogle({
            onCall: (route) => seen.push({ route, ledger: ledger() })
        });

        expect(await run(google, 'create', ...args)).toBe(0);
        const fixtures = ledger().fixtures;
        const hashes = fixtures.map(({ sha1 }) => sha1);
        expect(fixtures).toHaveLength(count);
        expect(new Set(hashes).size).toBe(count);
        expect(fixtures.every(({ upload, mediaKey }) => upload === 'ok' && mediaKey)).toBe(true);
        expect(google.media.size).toBe(count);
        expect(seen.every(({ ledger: saved }) => saved.fixtures.length === count)).toBe(true);

        const commits = seen.filter(({ route }) => route === 'commit');
        expect(commits).toHaveLength(count);
        for (const [index, { ledger: saved }] of commits.entries()) {
            expect(saved.fixtures.map(({ sha1 }) => sha1)).toEqual(hashes);
            expect(saved.fixtures.map(({ upload }) => upload)).toEqual([
                ...Array(index).fill('ok'),
                'pending',
                ...Array(count - index - 1).fill('none')
            ]);
        }
        const album = seen.find(({ route }) => route === 'album-create')?.ledger;
        expect(album?.fixtures.every(({ mediaKey }) => mediaKey)).toBe(true);

        expect(await run(google, 'probe')).toBe(0);
        expect(ledger().directUrls).toHaveLength(count);
        const unownedHash = 'f'.repeat(40);
        google.media.set(unownedHash, { key: 'unowned-media', body: new Uint8Array([1]) });

        expect(await run(google, 'cleanup')).toBe(0);
        expect(google.mutationTargets).toEqual([...hashes, ...hashes]);
        expect([...google.media.keys()]).toEqual([unownedHash]);
        expect(
            ledger().fixtures.every(
                ({ remove, presence }) => remove === 'ok' && presence === 'absent'
            )
        ).toBe(true);
    }
);

test.each(['create', 'probe', 'revoke', 'cleanup'])(
    '%s rejects invalid counts before credentials, ledger I/O or requests',
    async (command) => {
        rmSync(credentialsPath);
        const google = new FakeGoogle();

        for (const count of ['0', '-1', '1.5', '9007199254740992', 'NaN', 'Infinity', '']) {
            expect(await run(google, command, `--count=${count}`)).toBe(2);
            expect(existsSync(ledgerPath)).toBe(false);
        }
        writeFileSync(ledgerPath, 'keep this ledger');

        expect(await run(google, command, '--count=0')).toBe(2);
        expect(readFileSync(ledgerPath, 'utf8')).toBe('keep this ledger');
        expect(google.calls).toEqual([]);
        expect(output.every((line) => line.startsWith('Usage:'))).toBe(true);
    }
);

test.each(['probe', 'revoke', 'cleanup'])(
    '%s refuses a create-only count option',
    async (command) => {
        const google = new FakeGoogle();

        expect(await run(google, command, '--count=4')).toBe(2);
        expect(existsSync(ledgerPath)).toBe(false);
        expect(google.calls).toEqual([]);
    }
);
