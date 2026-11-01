<script lang="ts">
    import { Button, Dialog, LoadingIndicator } from 'noph-ui';
    import prettyBytes from 'pretty-bytes';
    import {
        MAX_IMAGE_PREVIEW_BYTES,
        previewModeFor,
        type FileGroup
    } from '@madkarmaa/phodrive-core/files';
    import { PreviewMode, PreviewUnavailableReason } from '@madkarmaa/phodrive-core/models';
    import type { EntryTarget } from '#browser/drive/menu-types';
    import { fetchFilePreview, type PreviewPayload } from '#browser/preview';
    import { cachePreview, getCachedPreview, previewCacheKey } from '#browser/preview-cache';

    interface Props {
        open?: boolean;
        target: EntryTarget | null;
        token: string;
        showOwner?: boolean;
        ondownload: (item: FileGroup) => void;
        ondetails: (item: FileGroup) => void;
        onclose: () => void;
    }

    let {
        open = false,
        target,
        token,
        showOwner = false,
        ondownload,
        ondetails,
        onclose
    }: Props = $props();

    type PreviewState =
        | { kind: 'loading' }
        | { kind: 'image'; url: string }
        | { kind: 'text'; text: string; truncated: boolean }
        | { kind: 'unavailable'; reason: PreviewUnavailableReason }
        | { kind: 'error'; message: string };

    let previewState = $state<PreviewState>({ kind: 'loading' });
    let attempt = $state(0);
    let objectUrl: string | null = null;

    const file = $derived(target?.kind === 'file' ? target.item : null);
    const mode = $derived(file === null ? null : previewModeFor(file.name));
    const size = $derived(
        file === null || !file.complete
            ? null
            : file.chunks.reduce((sum, chunk) => sum + chunk.size, 0)
    );
    const sizeLabel = $derived(size === null ? 'Size unknown' : prettyBytes(size));
    const meta = $derived(
        file === null ? '' : showOwner ? `${file.email} · ${sizeLabel}` : sizeLabel
    );
    const reason = $derived(
        previewState.kind === 'unavailable' ? reasonText(previewState.reason) : ''
    );

    function reasonText(value: PreviewUnavailableReason): string {
        if (value === PreviewUnavailableReason.MultiChunk)
            return 'This image is split across several chunks, so it cannot be shown here. Download it to view the full file.';
        if (value === PreviewUnavailableReason.TooLarge)
            return 'This image is too large to preview here. Download it to view the full file.';
        if (value === PreviewUnavailableReason.UnsupportedImage)
            return 'This file is not a JPEG, PNG, WebP or GIF image. Download it to view it.';
        if (value === PreviewUnavailableReason.IncompleteImage)
            return 'This image looks incomplete. Download it to check the file.';
        if (value === PreviewUnavailableReason.DecodeFailed)
            return 'This image could not be decoded. Download it to view it.';
        if (value === PreviewUnavailableReason.Binary)
            return 'This file does not look like text. Download it to view it.';
        if (value === PreviewUnavailableReason.Incomplete)
            return 'Load the remaining chunks before previewing this file.';

        return 'This file type cannot be previewed here. Download it to view it.';
    }

    function clearImage(): void {
        if (!objectUrl) return;

        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    }

    function apply(payload: PreviewPayload): void {
        clearImage();

        if (payload.kind === 'text') {
            previewState = { kind: 'text', text: payload.text, truncated: payload.truncated };

            return;
        }
        if (payload.kind === 'unavailable') {
            previewState = { kind: 'unavailable', reason: payload.reason };

            return;
        }

        try {
            objectUrl = URL.createObjectURL(payload.blob);
            previewState = { kind: 'image', url: objectUrl };
        } catch {
            previewState = {
                kind: 'error',
                message: 'Could not show this image. Download it instead.'
            };
        }
    }

    async function load(
        item: FileGroup,
        currentMode: PreviewMode,
        tokenValue: string,
        signal: AbortSignal
    ): Promise<void> {
        previewState = { kind: 'loading' };
        const key = previewCacheKey(item, currentMode);
        const cached = getCachedPreview(key);
        if (cached) {
            apply(cached);

            return;
        }

        const result = await fetchFilePreview(item, tokenValue, currentMode, signal);
        if (signal.aborted) return;

        result.match({
            Ok: (payload) => {
                cachePreview(key, payload);
                apply(payload);
            },
            Err: (error) => {
                previewState = { kind: 'error', message: error.message };
            }
        });
    }

    $effect(() => {
        const item = file;
        const currentMode = mode;
        const tokenValue = token;
        const openNow = open;
        void attempt;

        if (!openNow || item === null || tokenValue === '') return;
        if (currentMode === null) {
            previewState = { kind: 'unavailable', reason: PreviewUnavailableReason.Unsupported };

            return;
        }
        if (!item.complete) {
            previewState = { kind: 'unavailable', reason: PreviewUnavailableReason.Incomplete };

            return;
        }
        if (currentMode === PreviewMode.Image) {
            const chunk = item.chunks[0];
            if (item.chunks.length !== 1 || chunk === undefined || !chunk.isLast) {
                previewState = { kind: 'unavailable', reason: PreviewUnavailableReason.MultiChunk };

                return;
            }
            if (chunk.size > MAX_IMAGE_PREVIEW_BYTES) {
                previewState = { kind: 'unavailable', reason: PreviewUnavailableReason.TooLarge };

                return;
            }
        }

        const controller = new AbortController();
        void load(item, currentMode, tokenValue, controller.signal);

        return () => {
            controller.abort();
            clearImage();
            previewState = { kind: 'loading' };
        };
    });

    function imageFailed(): void {
        clearImage();
        previewState = { kind: 'unavailable', reason: PreviewUnavailableReason.DecodeFailed };
    }
</script>

<Dialog
    {open}
    style="--np-dialog-container-width: min(60rem, calc(100vw - 1rem)); --np-dialog-inset: 0.5rem;"
    headline={file?.name ?? 'Preview'}
    supportingText={meta}
    oncancel={(event) => {
        event.preventDefault();
        onclose();
    }}
    ontoggle={(event) => {
        if (event.newState === 'closed') onclose();
    }}
>
    {#if file}
        <div class="preview-surface">
            {#if previewState.kind === 'loading'}
                <div class="preview-state" role="status">
                    <LoadingIndicator aria-label="Loading preview" />
                    <p>Loading preview</p>
                </div>
            {:else if previewState.kind === 'image'}
                <img
                    class="preview-image"
                    src={previewState.url}
                    alt={`Preview of ${file.name}`}
                    onerror={imageFailed}
                />
            {:else if previewState.kind === 'text'}
                <pre class="preview-text">{previewState.text}</pre>
                {#if previewState.truncated}
                    <p class="preview-note">
                        Showing the start of this file. Download it to see everything.
                    </p>
                {/if}
            {:else if previewState.kind === 'unavailable'}
                <div class="preview-state">
                    <p class="preview-title">Preview not available</p>
                    <p class="preview-note">{reason}</p>
                </div>
            {:else}
                <div class="preview-state" role="alert">
                    <p class="preview-title">Preview failed</p>
                    <p class="preview-note">{previewState.message}</p>
                    <Button variant="text" onclick={() => attempt++}>Retry</Button>
                </div>
            {/if}
        </div>
    {/if}

    {#snippet actions()}
        <Button
            variant="text"
            onclick={() => {
                if (file) ondownload(file);
            }}
        >
            Download
        </Button>
        <Button
            variant="text"
            onclick={() => {
                if (file) ondetails(file);
            }}
        >
            Details
        </Button>
        <Button autofocus variant="text" onclick={onclose}>Close</Button>
    {/snippet}
</Dialog>

<style>
    .preview-surface {
        display: grid;
        min-height: 240px;
        max-height: 68vh;
        margin-top: 16px;
        padding: 16px;
        overflow: auto;
        border-radius: 12px;
        background: var(--app-preview);
    }

    .preview-image {
        max-width: 100%;
        max-height: 62vh;
        margin: auto;
        object-fit: contain;
    }

    .preview-text {
        max-height: 60vh;
        margin: 0;
        overflow: auto;
        color: var(--app-text);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.55;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
    }

    .preview-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        max-width: 44ch;
        margin: auto;
        color: var(--app-muted);
        text-align: center;
    }

    .preview-state p,
    .preview-note {
        margin: 0;
    }

    .preview-title {
        color: var(--app-text);
        font-size: 16px;
        font-weight: 500;
    }

    .preview-note {
        font-size: 13px;
        line-height: 1.5;
    }

    .preview-surface .preview-note {
        margin-top: 12px;
    }

    @media (width < 520px) {
        .preview-surface {
            min-height: 200px;
            padding: 12px;
        }

        .preview-text {
            font-size: 12px;
        }
    }
</style>
