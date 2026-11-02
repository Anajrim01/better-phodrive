import { decompressChunk } from './brotli';
import { api } from './client';
import type { PlannedFile } from './discover';
import { failureDetail } from './errors';
import { operationSignal } from './operations';
import { buildPreview } from './preview';
import { replacePreviewUrl } from './preview-url';
import { reassembleFile } from './reassemble';
import { MemorySink, openSink, saveBlob } from './sink';
import {
    clearMessage,
    finishBusy,
    setProgress,
    showMessage,
    showVerified,
    type FileUi
} from './ui-dom';

export async function savePlan(plan: PlannedFile, ui: FileUi): Promise<void> {
    if (ui.busy || ui.saved) return;

    const signal = operationSignal();

    return openSink(plan.name, plan.size, false).match({
        Err: async (error) => {
            if (error.code !== 'save_cancelled') showMessage(ui, failureDetail(error));
        },
        Ok: async (sink) => {
            ui.busy = true;
            ui.save.disabled = true;
            if (ui.preview) ui.preview.disabled = true;
            clearMessage(ui);
            ui.progress.hidden = false;
            setProgress(ui, 0, plan.size);

            const result = await reassembleFile(
                plan,
                sink,
                api.fetchBytes,
                decompressChunk,
                (written, total) => setProgress(ui, written, total),
                signal
            );

            return result.match({
                Err: async (error) => {
                    showMessage(ui, failureDetail(error));
                    ui.progress.hidden = true;
                    finishBusy(ui);
                },
                Ok: (value) => {
                    if (value.blob) saveBlob(value.blob, plan.name);
                    showVerified(ui, value);
                    finishBusy(ui);
                }
            });
        }
    });
}

export async function previewPlan(plan: PlannedFile, ui: FileUi): Promise<void> {
    const kind = ui.kind;
    const previewButton = ui.preview;
    if (ui.busy || !previewButton || !kind) return;

    if (!ui.previewBox.hidden) {
        ui.previewBox.hidden = true;
        ui.previewBox.replaceChildren();
        replacePreviewUrl();
        previewButton.textContent = 'Preview';
        return;
    }

    const signal = operationSignal();

    ui.busy = true;
    previewButton.disabled = true;
    ui.save.disabled = true;
    clearMessage(ui);
    ui.progress.hidden = false;
    setProgress(ui, 0, plan.size);

    const result = await reassembleFile(
        plan,
        new MemorySink(),
        api.fetchBytes,
        decompressChunk,
        (written, total) => setProgress(ui, written, total),
        signal
    );

    return result.match({
        Err: async (error) => {
            showMessage(ui, failureDetail(error));
            ui.progress.hidden = true;
            finishBusy(ui);
        },
        Ok: async (value) => {
            if (!value.blob) {
                showMessage(ui, 'The preview could not be built.');
                ui.progress.hidden = true;
                finishBusy(ui);
                return;
            }

            if (signal.aborted) {
                finishBusy(ui);

                return;
            }

            let preview;
            try {
                preview = await buildPreview(value.blob, kind, plan.name);
            } catch {
                showMessage(ui, 'The preview could not be built.');
                ui.progress.hidden = true;
                finishBusy(ui);

                return;
            }

            replacePreviewUrl(preview.objectUrl);
            ui.previewBox.replaceChildren(preview.node);
            ui.previewBox.hidden = false;
            ui.progress.hidden = true;
            previewButton.textContent = 'Hide preview';
            finishBusy(ui);
        }
    });
}
