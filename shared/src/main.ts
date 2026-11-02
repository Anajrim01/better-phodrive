import { Err, type Result } from 'results-ts';
import { previewPlan, savePlan } from './actions';
import { readPrefix, type AlbumResponse } from './api';
import { api } from './client';
import { discoverFiles } from './discover';
import { failureTitle, viewerFailure, type ViewerFailure } from './errors';
import { PROBE_BYTES } from './limits';
import { decodeManifest, type Manifest } from './manifest';
import { stopOperations } from './operations';
import { renderError, renderLanding, renderReading, renderShare } from './ui-pages';

let bootToken = 0;

function probeItem(item: AlbumResponse['items'][number]) {
    return api
        .fetchBytes(item.url, 'bytes=0-65535')
        .andThenAsync(async (response): Promise<Result<Uint8Array, ViewerFailure>> => {
            if (response.status !== 200 && response.status !== 206)
                return Err(viewerFailure('network_failed', 'A shared item did not answer.'));

            return readPrefix(response, PROBE_BYTES);
        });
}

async function loadShare(manifest: Manifest, token: number): Promise<void> {
    const album = await api.loadAlbum(manifest.album);
    if (token !== bootToken) return;

    return album.match({
        Err: async (error) => renderError(failureTitle(error), error, () => boot()),
        Ok: async (value) => {
            if (value.items.length === 0) {
                const failure = viewerFailure(
                    'share_incomplete',
                    'Share incomplete. The album has no items.'
                );
                renderError('Share incomplete', failure, () => boot());

                return;
            }

            const plans = await discoverFiles(value.items, manifest, probeItem);
            if (token !== bootToken) return;

            return plans.match({
                Err: (error) => renderError(failureTitle(error), error, () => boot()),
                Ok: (files) =>
                    renderShare(value, files, {
                        save: (plan, ui) => void savePlan(plan, ui),
                        preview: (plan, ui) => void previewPlan(plan, ui)
                    })
            });
        }
    });
}

function boot(): void {
    stopOperations();
    const token = ++bootToken;
    return decodeManifest(location.hash).match({
        Err: (error) => {
            if (error.code === 'manifest_missing') renderLanding(() => boot());
            else renderError(failureTitle(error), error, null);
        },
        Ok: (manifest) => {
            renderReading();
            void loadShare(manifest, token);
        }
    });
}

window.addEventListener('hashchange', () => boot());
boot();
