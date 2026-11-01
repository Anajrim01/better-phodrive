<script lang="ts">
    import { Button, LoadingIndicator } from 'noph-ui';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import type { PreviewState } from '#browser/preview-copy';

    interface Props {
        state: PreviewState;
        file: FileGroup;
        reason: string;
        onretry: () => void;
        onimageerror: () => void;
    }

    let { state, file, reason, onretry, onimageerror }: Props = $props();
</script>

<div class="preview-surface">
    {#if state.kind === 'loading'}
        <div class="preview-state" role="status">
            <LoadingIndicator aria-label="Loading preview" />
            <p>Loading preview</p>
        </div>
    {:else if state.kind === 'image'}
        <img
            class="preview-image"
            src={state.url}
            alt={`Preview of ${file.name}`}
            onerror={onimageerror}
        />
    {:else if state.kind === 'text'}
        <pre class="preview-text">{state.text}</pre>
        {#if state.truncated}
            <p class="preview-note">
                Showing the start of this file. Download it to see everything.
            </p>
        {/if}
    {:else if state.kind === 'unavailable'}
        <div class="preview-state">
            <p class="preview-title">Preview not available</p>
            <p class="preview-note">{reason}</p>
        </div>
    {:else}
        <div class="preview-state" role="alert">
            <p class="preview-title">Preview failed</p>
            <p class="preview-note">{state.message}</p>
            <Button variant="text" onclick={onretry}>Retry</Button>
        </div>
    {/if}
</div>

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
