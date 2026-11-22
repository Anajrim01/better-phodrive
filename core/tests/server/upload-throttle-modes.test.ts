import { afterEach, expect, test, vi } from 'vitest';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { uploadFiles as uploadFromBrowser } from '@madkarmaa/phodrive-core/browser/upload';
import type { UploadJob } from '@madkarmaa/phodrive-core/browser/upload/jobs';
import { ChunkFormat, ProcessingMode, UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    createThrottleCoordinator,
    type ThrottleCoordinator
} from '@madkarmaa/phodrive-core/server/photos/throttle';
import { fileUploadStream, receiveFileUpload } from '@madkarmaa/phodrive-core/server/upload/file';
import { uploadFiles } from '@madkarmaa/phodrive-core/server/upload';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadEventStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import { photosUploadHarness } from '../helpers/photos-harness';
import { TEST_ACCOUNT } from '../helpers/upload';

const ACCOUNT_KEY = 'account-a';

function throttledGoogle() {
    const harness = photosUploadHarness();
    let authCalls = 0;
    const fetcher: Fetcher = (input, init) => {
        if (String(input).includes('android.googleapis.com/auth')) {
            authCalls++;
            if (authCalls === 1)
                return Promise.resolve(
                    new Response(null, { status: 429, headers: { 'retry-after': '60' } })
                );
        }

        return harness.fetcher(input, init);
    };

    return { fetcher, authCalls: () => authCalls };
}

function serverModeFetch(google: Fetcher, coordinator: ThrottleCoordinator) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const received = await receiveFileUpload(new Request(`http://localhost${url}`, init));

        return received.match({
            Ok: (file) =>
                fileUploadStream(file, TEST_ACCOUNT, google, undefined, ACCOUNT_KEY, coordinator),
            Err: (error) => Response.json({ error: error.message }, { status: 400 })
        });
    });
}

function browserModeFetch(google: Fetcher, coordinator: ThrottleCoordinator) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const received = await receiveUpload(
            new Request(`http://localhost${url}`, init),
            TEST_ACCOUNT,
            ChunkFormat.Bmp
        );

        return received.match({
            Ok: (input) =>
                uploadEventStream({
                    run: (emit) =>
                        uploadFiles(input, emit, google, undefined, ACCOUNT_KEY, coordinator),
                    cancel: input.cancel
                }),
            Err: (error) => Response.json({ error: error.message }, { status: 400 })
        });
    });
}

async function run(mode: ProcessingMode) {
    const coordinator = createThrottleCoordinator(() => 0);
    const wait = vi.spyOn(coordinator, 'wait').mockResolvedValue();
    const google = throttledGoogle();
    const fetchMock =
        mode === ProcessingMode.Server
            ? serverModeFetch(google.fetcher, coordinator)
            : browserModeFetch(google.fetcher, coordinator);
    const jobs: UploadJob[] = [];
    const chunks: UploadedChunk[] = [];
    const uploaded = await uploadFromBrowser(
        [new File(['whole upload'], 'whole.bin')],
        TEST_ACCOUNT.email,
        1,
        (job) => jobs.push(job),
        (chunk) => chunks.push(chunk),
        mode,
        ACCOUNT_KEY
    );

    expect(uploaded.isOk()).toBe(true);
    expect(google.authCalls()).toBe(2);
    expect(wait).toHaveBeenCalledWith(ACCOUNT_KEY, expect.anything());
    expect(fetchMock).toHaveBeenCalledTimes(mode === ProcessingMode.Server ? 1 : 2);
    expect(jobs.at(-1)).toMatchObject({ status: UploadJobStatus.Complete });
    expect(chunks).toHaveLength(1);
}

afterEach(() => {
    vi.restoreAllMocks();
});

test('browser-processing chunks share the account cooldown on the server', async () => {
    await run(ProcessingMode.Browser);
});

test('server-processing chunk work shares the account cooldown on the server', async () => {
    await run(ProcessingMode.Server);
});
