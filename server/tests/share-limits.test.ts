import { afterEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { checkSnapshotLimits, MAX_SHARE_FILES, MAX_SHARE_CHUNKS } from '../src/shares/limits';
import { withIssuanceLimit } from '../src/shares/issuance';
import { snapshotFile, resolved, deferred } from './helpers/shares';
import { testContext } from './helpers/context';

afterEach(() => vi.useRealTimers());

function sources(files: number, chunks = 1, name = 'sample.bin') {
    return [
        {
            accountEmail: 'owner@google.example',
            files: Array.from({ length: files }, () => {
                const snapshot = snapshotFile('owner@google.example', 'a'.repeat(64), '', chunks);
                snapshot.file.name = name;
                return { snapshot, relativeFolder: '' };
            })
        }
    ];
}

test('snapshot bounds cover file count, chunk count and actual UTF-8 manifest size', () => {
    expect(checkSnapshotLimits('Share', sources(MAX_SHARE_FILES)).isOk()).toBe(true);
    expect(checkSnapshotLimits('Share', sources(MAX_SHARE_FILES + 1)).unwrapErr()).toBe(
        SERVER_ERRORS.SHARE_LIMIT_EXCEEDED
    );
    expect(checkSnapshotLimits('Share', sources(1, MAX_SHARE_CHUNKS)).isOk()).toBe(true);
    expect(checkSnapshotLimits('Share', sources(1, MAX_SHARE_CHUNKS + 1)).unwrapErr()).toBe(
        SERVER_ERRORS.SHARE_LIMIT_EXCEEDED
    );
    expect(
        checkSnapshotLimits('Share', sources(MAX_SHARE_FILES, 1, '文'.repeat(255))).unwrapErr()
    ).toBe(SERVER_ERRORS.SHARE_LIMIT_EXCEEDED);
    expect(checkSnapshotLimits('5 GB', sources(1, 26)).isOk()).toBe(true);
});

test('public issuance rejects excess parallel work and releases admission after an error', async () => {
    const context = testContext();
    const gate = deferred();
    const run = vi.fn(() =>
        Ok(undefined).andThenAsync(async () => {
            await gate.promise;
            return Ok('done');
        })
    );
    const first = withIssuanceLimit(context, 'account', run);
    const second = withIssuanceLimit(context, 'account', run);
    const third = await withIssuanceLimit(context, 'account', run);
    expect(third.unwrapErr()).toEqual({ ...SERVER_ERRORS.SHARE_BUSY, retryAfterSeconds: 1 });
    expect(run).toHaveBeenCalledTimes(2);
    expect((await withIssuanceLimit(context, 'other', () => resolved('other'))).isOk()).toBe(true);
    gate.resolve();
    expect((await first).isOk()).toBe(true);
    expect((await second).isOk()).toBe(true);
    expect((await withIssuanceLimit(context, 'account', () => resolved('next'))).isOk()).toBe(true);
    const failed = await withIssuanceLimit(context, 'account', () =>
        Ok(undefined).andThenAsync(async () => Err(SERVER_ERRORS.SHARE_MEDIA_UNAVAILABLE))
    );
    expect(failed.unwrapErr()).toBe(SERVER_ERRORS.SHARE_MEDIA_UNAVAILABLE);
    expect((await withIssuanceLimit(context, 'account', () => resolved('retry'))).isOk()).toBe(
        true
    );
});

test('one account cannot issue more than 60 capabilities in a minute across shares', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const context = testContext();
    const run = vi.fn(() => resolved('capability'));
    for (let i = 0; i < 60; i++)
        expect((await withIssuanceLimit(context, 'account', run)).isOk()).toBe(true);
    expect((await withIssuanceLimit(context, 'account', run)).unwrapErr()).toMatchObject({
        ...SERVER_ERRORS.SHARE_BUSY,
        retryAfterSeconds: 60
    });
    expect(run).toHaveBeenCalledTimes(60);
    vi.setSystemTime(36_000);
    expect((await withIssuanceLimit(context, 'account', run)).unwrapErr()).toMatchObject({
        retryAfterSeconds: 25
    });
    vi.setSystemTime(61_000);
    expect((await withIssuanceLimit(context, 'account', run)).isOk()).toBe(true);
});
