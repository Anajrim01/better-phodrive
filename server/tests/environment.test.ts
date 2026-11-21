import { FileSort, ProcessingMode, ThemeMode } from '@madkarmaa/phodrive-core/models';
import { expect, test } from 'vitest';
import { parseEnvironment, sharingDiagnostic } from '../src/environment';

const REQUIRED = {
    DATABASE_URL: 'postgres://phodrive:secret@127.0.0.1:5432/phodrive',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    PHODRIVE_PROCESSING: 'browser'
};

test('partial sharing configuration starts with one diagnostic containing no values', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    for (const partial of [
        { SHARE_CAPABILITY_KEY: key },
        { PUBLIC_EDGE_URL: 'https://edge.example' }
    ]) {
        const env = parseEnvironment({ ...REQUIRED, ...partial }).unwrap();
        expect(env.sharing).toBeNull();
        expect(sharingDiagnostic(env)).toBe(
            'Public sharing disabled: SHARE_CAPABILITY_KEY and PUBLIC_EDGE_URL must both be configured.'
        );
    }
    expect(sharingDiagnostic(parseEnvironment(REQUIRED).unwrap())).toBeNull();
    expect(
        sharingDiagnostic(
            parseEnvironment({
                ...REQUIRED,
                SHARE_CAPABILITY_KEY: key,
                PUBLIC_EDGE_URL: 'https://edge.example'
            }).unwrap()
        )
    ).toBeNull();
});

test('unset optional settings use the local defaults', () => {
    const parsed = parseEnvironment(REQUIRED).unwrap();

    expect(parsed).toMatchObject({
        HOST: '127.0.0.1',
        PORT: 3000,
        PHODRIVE_PROCESSING: ProcessingMode.Browser,
        PHODRIVE_DISABLE_SIGNUP: false
    });
    expect(parsed.BETTER_AUTH_URL).toBeUndefined();
});

test('server environment supports Docker, hostnames, IPv6 and ephemeral ports', () => {
    for (const HOST of ['0.0.0.0', 'localhost', '::1']) {
        const parsed = parseEnvironment({ ...REQUIRED, HOST, PORT: '0' }).unwrap();

        expect(parsed).toMatchObject({ HOST, PORT: 0 });
    }

    const parsed = parseEnvironment({ ...REQUIRED, HOST: ' 127.0.0.1 ', PORT: ' 65535 ' });

    expect(parsed.unwrap()).toMatchObject({ HOST: '127.0.0.1', PORT: 65535 });
});

test('invalid port values fail instead of silently choosing a port', () => {
    for (const PORT of ['', ' ', '-1', '1.5', '65536', 'NaN', 'Infinity', '0xBB8', '3e3']) {
        const parsed = parseEnvironment({ ...REQUIRED, PORT });

        expect(parsed.unwrapErr()).toBe('Invalid server environment: PORT.');
    }
});

test('processing, database, and secret are required and diagnostics never include values', () => {
    const missing = parseEnvironment({});

    expect(missing.unwrapErr()).toBe(
        'Invalid server environment: DATABASE_URL, BETTER_AUTH_SECRET, PHODRIVE_PROCESSING.'
    );

    const invalid = parseEnvironment({
        DATABASE_URL: 'mysql://user:private-value@host/db',
        BETTER_AUTH_SECRET: 'private-short',
        SHARE_CAPABILITY_KEY: 'private-key',
        PUBLIC_EDGE_URL: 'private-origin',
        PHODRIVE_PROCESSING: 'private-mode',
        HOST: 'bad host'
    });

    expect(invalid.unwrapErr()).toBe(
        'Invalid server environment: HOST, DATABASE_URL, BETTER_AUTH_SECRET, SHARE_CAPABILITY_KEY, PUBLIC_EDGE_URL, PHODRIVE_PROCESSING.'
    );
    expect(invalid.unwrapErr()).not.toContain('private');
});

test('unrelated environment variables are never read', () => {
    const parsed = parseEnvironment({
        ...REQUIRED,
        get UNRELATED_SECRET(): string {
            throw new Error('Unrelated secret must not be read');
        }
    });

    expect(parsed.isOk()).toBe(true);
});

test('signup can be disabled and deployment display defaults are read', () => {
    const parsed = parseEnvironment({
        ...REQUIRED,
        PHODRIVE_PROCESSING: 'server',
        PHODRIVE_DISABLE_SIGNUP: 'true',
        PHODRIVE_DEFAULT_THEME: 'dark',
        PHODRIVE_DEFAULT_SORT: 'name-desc',
        PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: '90',
        PHODRIVE_DEFAULT_CONCURRENT_WORKERS: '12'
    }).unwrap();

    expect(parsed.PHODRIVE_PROCESSING).toBe(ProcessingMode.Server);
    expect(parsed.PHODRIVE_DISABLE_SIGNUP).toBe(true);
    expect(parsed.preferencesDefaults).toEqual({
        theme: ThemeMode.Dark,
        fileSort: FileSort.NameDescending,
        refreshIntervalSeconds: 90,
        concurrentWorkers: 12
    });
});

test('sharing is off without both settings, and blank values count as unset', () => {
    const key = Buffer.alloc(32, 7).toString('base64');

    for (const settings of [
        {},
        { SHARE_CAPABILITY_KEY: '', PUBLIC_EDGE_URL: '' },
        { SHARE_CAPABILITY_KEY: key },
        { PUBLIC_EDGE_URL: 'https://edge.example' }
    ])
        expect(parseEnvironment({ ...REQUIRED, ...settings }).unwrap().sharing).toBeNull();
});

test('a malformed capability key stops startup without printing the key', () => {
    const key = Buffer.alloc(32, 7).toString('base64');

    for (const SHARE_CAPABILITY_KEY of [
        Buffer.alloc(31, 7).toString('base64'),
        Buffer.alloc(33, 7).toString('base64'),
        `${key}!`,
        `${key}AAAA`,
        key.slice(0, -1),
        `${key}=`,
        Buffer.alloc(32, 255).toString('base64url')
    ]) {
        const parsed = parseEnvironment({ ...REQUIRED, SHARE_CAPABILITY_KEY });

        expect(parsed.unwrapErr()).toBe('Invalid server environment: SHARE_CAPABILITY_KEY.');
    }
});

test.each([
    'https://edge.example',
    'https://edge.example/',
    'https://edge.example:8443',
    'http://localhost:8788',
    'http://127.0.0.1:8788',
    'http://[::1]:8788'
])('%s is an edge origin', (PUBLIC_EDGE_URL) => {
    const parsed = parseEnvironment({
        ...REQUIRED,
        SHARE_CAPABILITY_KEY: Buffer.alloc(32, 7).toString('base64'),
        PUBLIC_EDGE_URL
    });

    expect(parsed.unwrap().sharing?.edgeUrl).toBe(PUBLIC_EDGE_URL.replace(/\/$/, ''));
});

test.each([
    'edge.example',
    'http://edge.example',
    'ftp://edge.example',
    'https://user:secret@edge.example',
    'https://edge.example?query=1',
    'https://edge.example/?',
    'https://edge.example/#fragment',
    'https://edge.example/prefix',
    'https://EDGE.example'
])('%s is not an edge origin', (PUBLIC_EDGE_URL) => {
    const parsed = parseEnvironment({ ...REQUIRED, PUBLIC_EDGE_URL });

    expect(parsed.unwrapErr()).toBe('Invalid server environment: PUBLIC_EDGE_URL.');
});

test('sharing is on with both settings and the edge origin loses its trailing slash', () => {
    const key = Buffer.alloc(32, 7);
    const { sharing } = parseEnvironment({
        ...REQUIRED,
        SHARE_CAPABILITY_KEY: key.toString('base64'),
        PUBLIC_EDGE_URL: 'https://edge.example/'
    }).unwrap();

    expect(sharing).toEqual({ capabilityKey: key, edgeUrl: 'https://edge.example' });
});
