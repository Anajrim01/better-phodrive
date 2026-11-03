import { previewPlan, savePlan } from './actions';
import { api } from './client';
import { discoverFiles } from './discover';
import { failureTitle, viewerFailure } from './errors';
import { decodeManifest, type Manifest } from './manifest';
import { stopOperations } from './operations';
import { probeItem } from './probe';
import { renderError, renderLanding, renderReading, renderShare } from './ui-pages';

let bootToken = 0;

async function loadShare(manifest: Manifest, token: number): Promise<void> {
    const album = await api.loadAlbum(manifest.album);
    if (token !== bootToken) return;

    return album.match({
        Err: async (error) => renderError(failureTitle(error), error, () => boot()),
        Ok: async (value) => {
            if (value.items.length === 0) {
                const failure = viewerFailure('share_incomplete', 'The album has no items.');
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
