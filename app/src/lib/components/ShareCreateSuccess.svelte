<script lang="ts">
    import { TextField } from 'noph-ui';
    import type { ShareRecord } from '@madkarmaa/phodrive-core/share-models';
    import IconLink from '~icons/material-symbols/link';

    interface Props {
        record: ShareRecord;
        copyState?: 'idle' | 'copied' | 'manual' | 'failed';
        copyError?: string;
        storageNotice?: string;
    }

    let { record, copyState = 'idle', copyError = '', storageNotice = '' }: Props = $props();

    const copyMessage = $derived(
        copyState === 'copied'
            ? 'Link copied'
            : copyState === 'manual'
              ? 'Clipboard access is blocked. Select the link and copy it.'
              : copyState === 'failed'
                ? copyError || 'The link could not be copied. Select the link and copy it.'
                : ''
    );
</script>

<div class="mt-4 flex flex-col gap-3">
    <TextField
        class="w-full"
        label="Share link"
        value={record.shareUrl}
        readonly
        autocomplete="off"
        spellcheck={false}
        onfocus={(event) => event.currentTarget.select()}
        onclick={(event) => event.currentTarget.select()}
    >
        {#snippet start()}<IconLink aria-hidden="true" />{/snippet}
    </TextField>

    {#if copyMessage}
        <p class="share-copy-note" role="status">{copyMessage}</p>
    {/if}

    {#if storageNotice}
        <p class="share-notice" role="status">{storageNotice}</p>
    {/if}
</div>

<style>
    .share-copy-note {
        margin: 0;
        color: var(--app-muted);
        font-size: 0.875rem;
        line-height: 1.25rem;
    }

    .share-notice {
        margin: 0;
        border: 1px solid var(--app-border);
        border-radius: 16px;
        background: var(--app-panel);
        padding: 0.5rem 0.75rem;
        color: var(--app-muted);
        font-size: 0.875rem;
        line-height: 1.25rem;
    }
</style>
