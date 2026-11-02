import { Err, type AsyncResult, type Result } from 'results-ts';
import { readPrefix, type AlbumResponse, type ByteFetcher } from './api';
import { api } from './client';
import { viewerFailure, type ViewerFailure } from './errors';
import { PROBE_BYTES } from './limits';

export function probeItem(
    item: AlbumResponse['items'][number],
    fetchBytes: ByteFetcher = api.fetchBytes
): AsyncResult<Uint8Array, ViewerFailure> {
    return fetchBytes(item.downloadUrl, 'bytes=0-65535').andThenAsync(
        async (response): Promise<Result<Uint8Array, ViewerFailure>> => {
            if (response.status !== 200 && response.status !== 206)
                return Err(viewerFailure('network_failed', 'A shared item did not answer.'));

            return readPrefix(response, PROBE_BYTES);
        }
    );
}
