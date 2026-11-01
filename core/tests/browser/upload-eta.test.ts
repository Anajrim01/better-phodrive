import { expect, test } from 'vitest';
import {
    createUploadEventHandler,
    createUploadJobs,
    type UploadJob
} from '@madkarmaa/phodrive-core/browser/upload/jobs';
import { UploadEventType, UploadPhase } from '@madkarmaa/phodrive-core/models';

const TOTAL = 318_000_000;

test('a mid-file burst after a chunk gap keeps the estimate realistic', () => {
    const file = new File(['eta'], 'eta.bin');
    const sources = [{ file, jobId: 0 }];
    const jobs = createUploadJobs([file]);
    const published: UploadJob[] = [];
    let now = 0;
    const handle = createUploadEventHandler(
        sources,
        jobs,
        'eta@example.com',
        (job) => published.push(job),
        () => {},
        () => now
    );
    const progress = (at: number, completed: number) => {
        now = at;
        handle({
            type: UploadEventType.Progress,
            id: 0,
            progress: {
                phase: UploadPhase.Uploading,
                completed,
                reused: 0,
                total: TOTAL
            }
        });
    };

    handle({ type: UploadEventType.Queued, id: 0 });
    progress(0, 0);
    progress(1_000, 20_000_000);
    progress(3_000, 133_000_000);
    progress(10_000, 133_000_000);
    progress(13_200, 150_000_000);

    const afterBurst = published.at(-1)!;
    expect(afterBurst.etaSeconds).not.toBeNull();
    expect(afterBurst.etaSeconds!).toBeGreaterThan(10);

    progress(23_000, 160_000_000);

    const slowTail = published.at(-1)!;
    expect(slowTail.etaSeconds).not.toBeNull();
    expect(slowTail.etaSeconds!).toBeGreaterThan(15);
});

test('a fresh upload reports no estimate until the samples span enough time', () => {
    const file = new File(['eta'], 'eta.bin');
    const jobs = createUploadJobs([file]);
    const published: UploadJob[] = [];
    let now = 0;
    const handle = createUploadEventHandler(
        [{ file, jobId: 0 }],
        jobs,
        'eta@example.com',
        (job) => published.push(job),
        () => {},
        () => now
    );

    handle({ type: UploadEventType.Queued, id: 0 });
    now = 0;
    handle({
        type: UploadEventType.Progress,
        id: 0,
        progress: { phase: UploadPhase.Uploading, completed: 0, reused: 0, total: TOTAL }
    });
    now = 2_000;
    handle({
        type: UploadEventType.Progress,
        id: 0,
        progress: {
            phase: UploadPhase.Uploading,
            completed: 50_000_000,
            reused: 0,
            total: TOTAL
        }
    });

    const early = published.at(-1)!;
    expect(early.etaSeconds).toBeNull();
    expect(early.bytesPerSecond).toBe(0);
});
