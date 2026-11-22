import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { planUploads } from '#browser/drive/upload-plan';
import { THIRD_ACCOUNT, SECOND_ACCOUNT, TEST_ACCOUNT } from '../helpers/drive';

const GROUP = {
    id: 'group',
    name: 'Group',
    members: [TEST_ACCOUNT, SECOND_ACCOUNT, THIRD_ACCOUNT]
};

function file(name: string): File {
    return new File([new Uint8Array(100)], name);
}

function plan(files: readonly File[]) {
    return planUploads(files, { kind: 'group', group: GROUP });
}

function runQueues(
    queues: ReturnType<typeof plan>['queues'],
    wait: (account: GoogleAccountSummary) => Promise<void>,
    completed: Map<string, string>
) {
    return Promise.all(
        queues.map(async (queue) => {
            for (const [index, item] of queue.files.entries()) {
                await wait(queue.account);
                completed.set(item.name, queue.account.id);
            }
        })
    );
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

test('a paused owner keeps its files while the other queues finish', async () => {
    const planned = plan(['a.bin', 'b.bin', 'c.bin', 'd.bin', 'e.bin', 'f.bin'].map(file));
    const throttle = createThrottleCoordinator(() => 0);
    throttle.pause(TEST_ACCOUNT.id, 60);
    const completed = new Map<string, string>();
    const owners = new Map(planned.owners);

    const queues = runQueues(planned.queues, (account) => throttle.wait(account.id), completed);

    await vi.advanceTimersByTimeAsync(30_000);
    expect([...completed.values()]).not.toContain(TEST_ACCOUNT.id);
    expect(completed.size).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(30_000);
    await queues;

    expect(completed.size).toBe(6);
    expect([...completed.entries()]).toEqual(
        expect.arrayContaining([
            ['a.bin', TEST_ACCOUNT.id],
            ['d.bin', TEST_ACCOUNT.id]
        ])
    );
    expect(planned.owners).toEqual(owners);
});

test('every assigned queue paused waits until each account deadline', async () => {
    const planned = plan([file('a.bin'), file('b.bin'), file('c.bin')]);
    const throttle = createThrottleCoordinator(() => 0);
    for (const account of GROUP.members) throttle.pause(account.id, 60);
    const completed = new Map<string, string>();

    const queues = runQueues(planned.queues, (account) => throttle.wait(account.id), completed);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(completed.size).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    await queues;

    expect(completed.size).toBe(3);
    expect(planned.owners).toEqual(
        new Map([
            [0, TEST_ACCOUNT],
            [1, SECOND_ACCOUNT],
            [2, THIRD_ACCOUNT]
        ])
    );
});
