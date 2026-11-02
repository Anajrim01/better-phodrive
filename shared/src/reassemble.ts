import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { createSHA256 } from 'hash-wasm';
import type { ByteFetcher } from './api';
import { consumeChunkRanges, type Decompressor } from './chunk-stream';
import { viewerFailure, type ViewerFailure } from './errors';
import type { PlannedFile } from './discover';
import type { ByteSink } from './sink';

export interface ReassemblyResult {
    sha256: string;
    size: number;
    blob: Blob | null;
}

export type Progress = (written: number, total: number) => void;

async function abortWith<T>(
    sink: ByteSink,
    failure: ViewerFailure
): Promise<Result<T, ViewerFailure>> {
    await sink.abort();

    return Err(failure);
}

export function reassembleFile(
    plan: PlannedFile,
    sink: ByteSink,
    fetchBytes: ByteFetcher,
    decompress: Decompressor,
    onProgress: Progress,
    signal: AbortSignal
): AsyncResult<ReassemblyResult, ViewerFailure> {
    return Ok(undefined).andThenAsync(
        async (): Promise<Result<ReassemblyResult, ViewerFailure>> => {
            if (signal.aborted)
                return abortWith(
                    sink,
                    viewerFailure('cancelled', 'The share changed, so the download stopped.')
                );

            let hasher;
            try {
                hasher = await createSHA256();
                hasher.init();
            } catch {
                return abortWith(
                    sink,
                    viewerFailure('integrity_failed', 'The file hash could not be started.')
                );
            }

            let written = 0;
            onProgress(0, plan.size);

            for (const chunk of plan.chunks) {
                if (signal.aborted)
                    return abortWith(
                        sink,
                        viewerFailure('cancelled', 'The share changed, so the download stopped.')
                    );

                const consumed = await consumeChunkRanges(
                    chunk.item.downloadUrl,
                    chunk.header,
                    fetchBytes,
                    sink,
                    hasher,
                    decompress,
                    (bytes) => onProgress(bytes, plan.size),
                    written,
                    signal
                );
                const copied = consumed.match<{ bytes: number } | { error: ViewerFailure }>({
                    Ok: (bytes) => ({ bytes }),
                    Err: (error) => ({ error })
                });
                if ('error' in copied) return abortWith(sink, copied.error);

                written += copied.bytes;
            }

            if (written !== plan.size)
                return abortWith(
                    sink,
                    viewerFailure('integrity_failed', 'The file size does not match.')
                );

            let digest: string;
            try {
                digest = hasher.digest('hex');
            } catch {
                return abortWith(
                    sink,
                    viewerFailure('integrity_failed', 'The file hash could not be finished.')
                );
            }

            if (digest !== plan.fileHash)
                return abortWith(
                    sink,
                    viewerFailure(
                        'integrity_failed',
                        'The file failed its SHA-256 check. Nothing was saved.'
                    )
                );

            if (signal.aborted)
                return abortWith(
                    sink,
                    viewerFailure('cancelled', 'The share changed, so the download stopped.')
                );

            const closed = await sink.close();
            return closed.match({
                Err: (error) => abortWith(sink, error),
                Ok: async (blob) => Ok({ sha256: digest, size: written, blob })
            });
        }
    );
}
