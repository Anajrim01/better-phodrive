import { Err, Ok, type AsyncResult } from 'results-ts';
import { viewerFailure, type ViewerFailure } from './errors';
import { sanitizeFileName } from './file-name';
import { BLOB_DOWNLOAD_BYTES } from './limits';

export interface ByteSink {
    write(bytes: Uint8Array): AsyncResult<void, ViewerFailure>;
    close(): AsyncResult<Blob | null, ViewerFailure>;
    abort(): Promise<void>;
}

interface SaveFilePicker {
    (options: { suggestedName?: string }): Promise<FileSystemFileHandle>;
}

function saveFilePicker(): SaveFilePicker | undefined {
    return (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
}

function arrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    if (bytes.buffer instanceof ArrayBuffer) return bytes as Uint8Array<ArrayBuffer>;

    return new Uint8Array(bytes);
}

class PickerSink implements ByteSink {
    private constructor(private readonly writable: FileSystemWritableFileStream) {}

    static open(name: string): AsyncResult<PickerSink, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () => {
            const picker = saveFilePicker();
            if (!picker)
                return Err(viewerFailure('save_failed', 'Saving to disk is not available.'));

            try {
                const handle = await picker({ suggestedName: sanitizeFileName(name) });

                return Ok(new PickerSink(await handle.createWritable()));
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError')
                    return Err(viewerFailure('save_cancelled', 'Save cancelled.'));

                return Err(
                    viewerFailure('save_failed', 'The file could not be opened for saving.')
                );
            }
        });
    }

    write(bytes: Uint8Array): AsyncResult<void, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () => {
            try {
                await this.writable.write(arrayBufferBytes(bytes));

                return Ok(undefined);
            } catch {
                return Err(viewerFailure('save_failed', 'The file could not be written.'));
            }
        });
    }

    close(): AsyncResult<Blob | null, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () => {
            try {
                await this.writable.close();

                return Ok(null);
            } catch {
                return Err(viewerFailure('save_failed', 'The file could not be saved.'));
            }
        });
    }

    async abort(): Promise<void> {
        try {
            await this.writable.abort();
        } catch {
            return;
        }
    }
}

export class MemorySink implements ByteSink {
    private readonly parts: Uint8Array[] = [];

    write(bytes: Uint8Array): AsyncResult<void, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () => {
            if (bytes.byteLength > 0) this.parts.push(bytes);

            return Ok(undefined);
        });
    }

    close(): AsyncResult<Blob | null, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () =>
            Ok(new Blob(this.parts.map(arrayBufferBytes), { type: 'application/octet-stream' }))
        );
    }

    async abort(): Promise<void> {
        this.parts.length = 0;
    }
}

export function openSink(
    name: string,
    size: number,
    preview: boolean
): AsyncResult<ByteSink, ViewerFailure> {
    return Ok(undefined).andThenAsync(async () => {
        if (preview) return Ok<ByteSink>(new MemorySink());
        if (saveFilePicker()) return PickerSink.open(name).map((sink): ByteSink => sink);

        if (size > BLOB_DOWNLOAD_BYTES)
            return Err(
                viewerFailure(
                    'too_large',
                    'This browser cannot stream large files to disk. Use Chrome or Edge for files above 512 MB.'
                )
            );

        return Ok<ByteSink>(new MemorySink());
    });
}

export function saveBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizeFileName(name);
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
