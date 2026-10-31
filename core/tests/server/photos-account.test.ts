import { expect, test } from 'vitest';
import { validateAasAccount } from '@madkarmaa/phodrive-core/server/photos';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';

test('account validation checks the email and AAS token with Google', async () => {
    const accepted: Fetcher = async (input, init) => {
        expect(String(input)).toBe('https://android.googleapis.com/auth');
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('Email')).toBe('test@example.com');
        expect(form.get('Token')).toBe('aas_et/test');
        return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
    };
    const valid = await validateAasAccount('test@example.com', 'aas_et/test', accepted);
    expect(valid.isOk()).toBe(true);

    const rejected: Fetcher = async () => new Response('Error=BadAuthentication');
    const invalid = await validateAasAccount('test@example.com', 'aas_et/test', rejected);
    expect(invalid.match({ Ok: () => '', Err: (error) => error.message })).toBe(
        'AAS authentication failed'
    );
});
