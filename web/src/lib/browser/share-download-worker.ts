import type {
    ShareDownloadWorkerReply,
    ShareDownloadWorkerRequest
} from './share-download-protocol';
import { ShareDownloadWriter, createShareDownloadSink } from './share-download-writer';
import { Err } from 'results-ts';

const SAVE_FAILED = {
    code: 'DOWNLOAD_SAVE_FAILED',
    message: 'Could not save the downloaded file.'
} as const;

let active: ShareDownloadWriter | null = null;

function reply(message: ShareDownloadWorkerReply): void {
    self.postMessage(message, { transfer: [] });
}

function failed(): void {
    reply({ kind: 'failed', error: SAVE_FAILED });
}

async function open(message: Extract<ShareDownloadWorkerRequest, { kind: 'open' }>) {
    const started = await createShareDownloadSink(
        message.handle ?? null,
        message.name
    ).andThenAsync(async (sink) => {
        const writer = await ShareDownloadWriter.start(message.file, sink);

        if (writer.isErr()) await sink.discard();

        return writer;
    });

    started.match({
        Ok: (writer) => {
            active = writer;
            reply({ kind: 'opened' });
        },
        Err: (error) => reply({ kind: 'failed', error })
    });
}

async function append(bytes: Uint8Array<ArrayBuffer>) {
    if (!active) {
        failed();

        return;
    }

    const writer = active;
    const written = await writer
        .append(bytes)
        .orElseAsync((error) => writer.abort().andThen(() => Err(error)));

    written.match({
        Ok: () => reply({ kind: 'appended' }),
        Err: (error) => {
            active = null;
            reply({ kind: 'failed', error });
        }
    });
}

async function finish() {
    if (!active) {
        failed();

        return;
    }

    const completion = await active.finish();
    active = null;

    completion.match({
        Ok: (value) =>
            reply(
                value.kind === 'handle'
                    ? { kind: 'finished', handle: value.handle }
                    : { kind: 'finished' }
            ),
        Err: (error) => reply({ kind: 'failed', error })
    });
}

async function abort() {
    const writer = active;
    active = null;

    if (writer) await writer.abort();

    reply({ kind: 'aborted' });
}

async function handle(message: ShareDownloadWorkerRequest): Promise<void> {
    switch (message.kind) {
        case 'open':
            await open(message);

            return;
        case 'append':
            await append(message.bytes);

            return;
        case 'finish':
            await finish();

            return;
        case 'abort':
            await abort();
    }
}

self.addEventListener('message', (event: MessageEvent<ShareDownloadWorkerRequest>) => {
    void handle(event.data);
});
