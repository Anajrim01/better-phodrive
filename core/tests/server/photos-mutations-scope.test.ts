import { expect, test, vi } from 'vitest';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    mutatePhotos,
    type MutationTarget
} from '@madkarmaa/phodrive-core/server/photos/mutations';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { bytesField, message } from '@madkarmaa/phodrive-core/server/protobuf';
import { authResponse } from '../helpers/protobuf';

const ACCOUNT = { email: 'test@example.com', token: 'aas_et/test' };
const AUTH_URL = 'https://android.googleapis.com/auth';
const MUTATION_RPC = '17490284929287180316';
const SCOPE_KEY = 'account-a';

function scope() {
    return { key: SCOPE_KEY, coordinator: createThrottleCoordinator(() => 0) };
}

function mutationTargets(count: number): MutationTarget[] {
    return Array.from({ length: count }, (_, index) => ({
        mediaKey: `media-key-${index}`,
        sha1: index.toString(16).padStart(40, '0')
    }));
}

function confirmedBody(mediaKeys: readonly string[]): Buffer {
    return message(
        ...mediaKeys.map((mediaKey) => bytesField(1, mediaKey)),
        bytesField(2, message(bytesField(1, 'item-identity')))
    );
}

function respondingFetcher(respond: () => Response) {
    const fetcher: Fetcher = async (input, init) => {
        if (String(input) === AUTH_URL) return authResponse();
        expect(String(input)).toContain(MUTATION_RPC);
        await new Response(init?.body).arrayBuffer();

        return respond();
    };

    return fetcher;
}

test('a metadata failure keeps the confirmed mutation and reports the failure', async () => {
    const targets = mutationTargets(1);
    const fetcher = respondingFetcher(
        () => new Response(Uint8Array.from(confirmedBody(targets.map((target) => target.mediaKey))))
    );

    const result = await mutatePhotos('delete', ACCOUNT, targets, scope(), fetcher, async () => {
        throw new Error('metadata unavailable');
    });
    const outcome = result.unwrap();

    expect(outcome.applied).toHaveLength(1);
    expect(outcome.failure).toEqual(SERVER_ERRORS.METADATA_UNAVAILABLE);
});

test('an aborted scope stops before any Google request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<Fetcher>();

    const result = await mutatePhotos(
        'trash',
        ACCOUNT,
        mutationTargets(1),
        {
            key: SCOPE_KEY,
            coordinator: createThrottleCoordinator(() => 0),
            signal: controller.signal
        },
        fetcher
    );

    expect(result.unwrapErr()).toMatchObject({ code: 'UPLOAD_CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled();
});

test('a throttled mutation pauses only its own scope key', async () => {
    const coordinator = createThrottleCoordinator(() => 0);
    const fetcher = respondingFetcher(
        () => new Response(null, { status: 429, headers: { 'retry-after': '120' } })
    );

    const result = await mutatePhotos(
        'trash',
        ACCOUNT,
        mutationTargets(1),
        { key: SCOPE_KEY, coordinator },
        fetcher
    );

    expect(result.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 120 });
    expect(coordinator.remaining(SCOPE_KEY)).toBeGreaterThan(0);
    expect(coordinator.remaining('account-b')).toBe(0);
});
