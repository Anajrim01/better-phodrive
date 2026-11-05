import { expect, test, vi } from 'vitest';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    validateMutationResponse,
    type MutationKind
} from '@madkarmaa/phodrive-core/server/photos/mutation-response';
import {
    MUTATION_BATCH_SIZE,
    mutatePhotos,
    type MutationTarget
} from '@madkarmaa/phodrive-core/server/photos/mutations';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    bytesField,
    message,
    nested,
    numberField,
    parse,
    type Field
} from '@madkarmaa/phodrive-core/server/protobuf';
import {
    CAPTURED_ALREADY_TRASHED,
    CAPTURED_ALREADY_TRASHED_KEY,
    CAPTURED_DELETE_KEY,
    CAPTURED_DELETE_SUCCESS
} from '../fixtures/trash-responses';
import { authResponse } from '../helpers/protobuf';

const ACCOUNT = { email: 'test@example.com', token: 'aas_et/test' };
const AUTH_URL = 'https://android.googleapis.com/auth';
const MUTATION_RPC = '17490284929287180316';
const SCOPE_KEY = 'account-a';

const OPERATIONS: Record<MutationKind, number> = { trash: 1, restore: 3, delete: 2 };

function scope(key = SCOPE_KEY) {
    return { key, coordinator: createThrottleCoordinator(() => 0) };
}

function mutationTargets(count: number, prefix = 'media-key'): MutationTarget[] {
    return Array.from({ length: count }, (_, index) => ({
        mediaKey: `${prefix}-${index}`,
        sha1: index.toString(16).padStart(40, '0')
    }));
}

function confirmedBody(mediaKeys: readonly string[]): Buffer {
    return message(
        ...mediaKeys.map((mediaKey) => bytesField(1, mediaKey)),
        bytesField(2, message(bytesField(1, 'item-identity')))
    );
}

function respondingFetcher(respond: (index: number, body: Buffer) => Response) {
    const urls: string[] = [];
    const mutations: Buffer[] = [];
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        urls.push(url);
        if (url === AUTH_URL) return authResponse();

        expect(url).toContain(MUTATION_RPC);
        const body = Buffer.from(await new Response(init?.body).arrayBuffer());
        mutations.push(body);

        return respond(mutations.length - 1, body);
    };

    return { fetcher, urls, mutations };
}

function numericFields(fields: readonly Field[]): Map<number, number> {
    const numbers = new Map<number, number>();

    for (const field of fields)
        if (typeof field.value === 'number') numbers.set(field.number, field.value);

    return numbers;
}

function fieldKeys(fields: readonly Field[]): string[] {
    return fields
        .filter((field) => field.number === 3)
        .map((field) => (typeof field.value === 'number' ? '' : field.value.toString('utf8')));
}

function itemIdentity(body: Buffer): string {
    const fields = parse(body).unwrap();
    const item = fields.find((field) => field.number === 2);
    const value = item && typeof item.value !== 'number' ? item.value : Buffer.alloc(0);

    return nested(value, 6, 1).unwrap().toString('utf8');
}

test('the captured success applies only requested field-1 keys', () => {
    const itemKey = itemIdentity(CAPTURED_DELETE_SUCCESS);
    expect(itemKey).not.toBe(CAPTURED_DELETE_KEY);

    const receipt = validateMutationResponse('trash', CAPTURED_DELETE_SUCCESS, [
        CAPTURED_DELETE_KEY,
        itemKey
    ]).unwrap();

    expect(receipt).toEqual({ applied: [CAPTURED_DELETE_KEY], alreadyApplied: false });
});

test('one trash target accepts the captured already-trashed body', () => {
    const receipt = validateMutationResponse('trash', CAPTURED_ALREADY_TRASHED, [
        CAPTURED_ALREADY_TRASHED_KEY
    ]).unwrap();

    expect(receipt).toEqual({
        applied: [CAPTURED_ALREADY_TRASHED_KEY],
        alreadyApplied: true
    });
});

test.each(['restore', 'delete'] as const)(
    '%s rejects the captured already-trashed body',
    (kind) => {
        const result = validateMutationResponse(kind, CAPTURED_ALREADY_TRASHED, [
            CAPTURED_ALREADY_TRASHED_KEY
        ]);

        expect(result.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);
    }
);

test('an unknown field-1 key is rejected', () => {
    const result = validateMutationResponse('trash', CAPTURED_DELETE_SUCCESS, ['another-key']);

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);
});

test('a duplicate field-1 key is rejected', () => {
    const duplicate = message(
        bytesField(1, 'duplicate-key'),
        bytesField(1, 'duplicate-key'),
        bytesField(2, message(bytesField(1, 'item-identity')))
    );
    const result = validateMutationResponse('trash', duplicate, ['duplicate-key']);

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);
});

test('an empty body is rejected', () => {
    const result = validateMutationResponse('trash', Buffer.alloc(0), ['requested-key']);

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);
});

test('a non-bytes field-1 is rejected', () => {
    const body = message(numberField(1, 7), bytesField(2, message(bytesField(1, 'item-identity'))));
    const result = validateMutationResponse('trash', body, ['requested-key']);

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);
});

test('a truncated body is rejected', () => {
    const result = validateMutationResponse('trash', Buffer.from([0x0a, 0x05, 0x41]), [
        'requested-key'
    ]);

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.TRUNCATED_PROTOBUF_FIELD);
});

test('an item identity outside the requested trash key reports DUPLICATE_IN_TRASH', () => {
    const result = validateMutationResponse('trash', CAPTURED_ALREADY_TRASHED, ['requested-key']);

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.DUPLICATE_IN_TRASH);
});

test.each(['trash', 'restore', 'delete'] as const)(
    '%s sends its operation, action, and one key per target after auth',
    async (kind) => {
        const targets = mutationTargets(2);
        const expectedKeys = targets.map((target) =>
            Buffer.from(target.sha1, 'hex').toString('base64url')
        );
        const { fetcher, urls, mutations } = respondingFetcher(
            () =>
                new Response(
                    Uint8Array.from(confirmedBody(targets.map((target) => target.mediaKey)))
                )
        );

        const result = await mutatePhotos(kind, ACCOUNT, targets, scope(), fetcher);

        expect(result.isOk()).toBe(true);
        expect(urls[0]).toBe(AUTH_URL);
        expect(urls).toHaveLength(2);
        expect(mutations).toHaveLength(1);

        const fields = parse(mutations[0]!).unwrap();
        const numbers = numericFields(fields);

        expect(numbers.get(2)).toBe(OPERATIONS[kind]);
        expect(numbers.get(4)).toBe(kind === 'trash' ? 1 : 2);
        expect(fieldKeys(fields)).toEqual(expectedKeys);
    }
);

test.each([1, 500, 501])(
    '%i targets send one auth request and the expected mutation batches',
    async (count) => {
        const targets = mutationTargets(count);
        const { fetcher, urls, mutations } = respondingFetcher((index) => {
            const batch = targets.slice(
                index * MUTATION_BATCH_SIZE,
                (index + 1) * MUTATION_BATCH_SIZE
            );

            return new Response(
                Uint8Array.from(confirmedBody(batch.map((target) => target.mediaKey)))
            );
        });

        const result = await mutatePhotos('trash', ACCOUNT, targets, scope(), fetcher);
        const batches = Math.ceil(count / MUTATION_BATCH_SIZE);

        expect(result.unwrap().applied).toHaveLength(count);
        expect(urls[0]).toBe(AUTH_URL);
        expect(urls.filter((url) => url === AUTH_URL)).toHaveLength(1);
        expect(mutations).toHaveLength(batches);
        expect(urls).toHaveLength(batches + 1);

        mutations.forEach((body, index) => {
            const fields = parse(body).unwrap();
            const expectedKeys = Math.min(MUTATION_BATCH_SIZE, count - index * MUTATION_BATCH_SIZE);

            expect(fieldKeys(fields)).toHaveLength(expectedKeys);
        });
    }
);

test('a later failed batch keeps the first confirmed 500 targets', async () => {
    const targets = mutationTargets(501);
    const applied: MutationTarget[] = [];
    const onApplied = vi.fn((batch: readonly MutationTarget[]) => {
        applied.push(...batch);
    });
    const { fetcher, mutations } = respondingFetcher((index) => {
        if (index === 1) return new Response(null, { status: 500 });

        return new Response(
            Uint8Array.from(
                confirmedBody(
                    targets.slice(0, MUTATION_BATCH_SIZE).map((target) => target.mediaKey)
                )
            )
        );
    });

    const result = await mutatePhotos('trash', ACCOUNT, targets, scope(), fetcher, onApplied);
    const outcome = result.unwrap();

    expect(mutations).toHaveLength(2);
    expect(outcome.applied).toHaveLength(500);
    expect(outcome.failure).toMatchObject({
        code: 'REQUEST_FAILED',
        status: 500,
        stage: 'Move to trash'
    });
    expect(onApplied).toHaveBeenCalledOnce();
    expect(applied).toHaveLength(500);
});

test('an unknown field-1 response applies nothing', async () => {
    const onApplied = vi.fn();
    const { fetcher } = respondingFetcher(
        () => new Response(Uint8Array.from(CAPTURED_DELETE_SUCCESS))
    );

    const result = await mutatePhotos(
        'trash',
        ACCOUNT,
        [{ mediaKey: 'requested-media-key', sha1: 'a'.repeat(40) }],
        scope(),
        fetcher,
        onApplied
    );

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_MUTATION_RESPONSE);
    expect(onApplied).not.toHaveBeenCalled();
});
