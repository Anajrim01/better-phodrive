import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { createSHA256 } from 'hash-wasm';
import type { ByteFetcher } from './api';
import { consumeChunk, type Decompressor } from './chunk-stream';
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
    onProgress: Progress
): AsyncResult<ReassemblyResult, ViewerFailure> {
    return Ok(undefined).andThenAsync(
        async (): Promise<Result<ReassemblyResult, ViewerFailure>> => {
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
                const response = await fetchBytes(chunk.item.downloadUrl);
                const consumed = await response.match({
                    Err: (error) => abortWith<void>(sink, error),
                    Ok: async (value) => {
                        if (value.status !== 200)
                            return abortWith<void>(
                                sink,
                                viewerFailure(
                                    'chunk_invalid',
                                    'A chunk did not download completely.'
                                )
                            );

                        const copied = await consumeChunk(
                            value,
                            chunk.header,
                            sink,
                            hasher,
                            decompress,
                            (bytes) => onProgress(bytes, plan.size),
                            written
                        );

                        return copied.match({
                            Err: async (error) => abortWith<void>(sink, error),
                            Ok: async (bytes) => {
                                written += bytes;

                                return Ok(undefined);
                            }
                        });
                    }
                });
                if (consumed.isErr()) return consumed;
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

            const closed = await sink.close();
            return closed.match({
                Err: (error) => abortWith(sink, error),
                Ok: async (blob) => Ok({ sha256: digest, size: written, blob })
            });
        }
    );
}
