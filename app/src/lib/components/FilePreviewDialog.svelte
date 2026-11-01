<script lang="ts">
    import { Button, Dialog } from 'noph-ui';
    import prettyBytes from 'pretty-bytes';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import {
        MAX_IMAGE_PREVIEW_BYTES,
        PreviewMode,
        PreviewUnavailableReason,
        previewModeFor
    } from '@madkarmaa/phodrive-core/preview';
    import type { EntryTarget } from '#browser/drive/menu-types';
    import { fetchFilePreview, type PreviewPayload } from '#browser/preview';
    import { cachePreview, getCachedPreview, previewCacheKey } from '#browser/preview-cache';
    import { previewReason, type PreviewState } from '#browser/preview-copy';
    import FilePreviewContent from '#components/FilePreviewContent.svelte';

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
        previewState.kind === 'unavailable' ? previewReason(previewState.reason) : ''
    );

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
        <FilePreviewContent
            state={previewState}
            {file}
            {reason}
            onretry={() => attempt++}
            onimageerror={imageFailed}
        />
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
