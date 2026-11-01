<script lang="ts">
    import { Button, IconButton } from 'noph-ui';
    import { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import IconDownload from '~icons/material-symbols/download';
    import IconDelete from '~icons/material-symbols/delete-outline';
    import IconDeleteForever from '~icons/material-symbols/delete-forever';
    import IconRestore from '~icons/material-symbols/restore-from-trash';

    interface Props {
        item: FileGroup;
        disabled: boolean;
        working: FileActionKind | null;
        compact?: boolean;
        trash?: boolean;
        partial?: boolean;
        shortDelete?: boolean;
        ondownload?: (item: FileGroup) => void;
        ondelete?: (item: FileGroup) => void;
        onrestore?: (item: FileGroup) => void;
        ondeleteforever?: (item: FileGroup) => void;
    }

    let {
        item,
        disabled,
        working,
        compact = false,
        trash = false,
        partial = false,
        shortDelete = false,
        ondownload,
        ondelete,
        onrestore,
        ondeleteforever
    }: Props = $props();

    const waiting = $derived(!item.complete && partial && !trash);
    const canRestore = $derived(
        !partial &&
            !item.trashed &&
            item.trashedChunks.some(
                (trashed) => !item.chunks.some((active) => active.chunkIndex === trashed.chunkIndex)
            )
    );
    const deleteLabel = $derived(
        item.complete ? `Delete ${item.name}` : `Delete remaining chunks of ${item.name}`
    );
    const deleteButtonLabel = $derived(
        shortDelete || item.complete ? 'Delete' : 'Delete remaining chunks'
    );
    const restoreLabel = $derived(`Restore ${item.name}`);
    const deleteForeverLabel = $derived(`Delete ${item.name} forever`);
</script>

<div class="file-actions flex shrink-0 items-center">
    {#if waiting}
        <span class="sr-only">Load more to check the rest of this file.</span>
    {:else if compact}
        {#if trash}
            <IconButton
                size="xs"
                title={restoreLabel}
                {disabled}
                loading={working === FileActionKind.Restore}
                loadingAriaLabel={`Restoring ${item.name}`}
                onclick={() => onrestore?.(item)}><IconRestore aria-hidden="true" /></IconButton
            >
            <IconButton
                size="xs"
                title={deleteForeverLabel}
                {disabled}
                loading={working === FileActionKind.DeleteForever}
                loadingAriaLabel={`Deleting ${item.name} forever`}
                onclick={() => ondeleteforever?.(item)}
                ><IconDeleteForever aria-hidden="true" /></IconButton
            >
        {:else}
            {#if canRestore}
                <IconButton
                    size="xs"
                    title={restoreLabel}
                    {disabled}
                    loading={working === FileActionKind.Restore}
                    loadingAriaLabel={`Restoring ${item.name}`}
                    onclick={() => onrestore?.(item)}><IconRestore aria-hidden="true" /></IconButton
                >
            {/if}
            {#if item.complete}
                <IconButton
                    size="xs"
                    title={`Download ${item.name}`}
                    {disabled}
                    loading={working === FileActionKind.Download}
                    loadingAriaLabel={`Downloading ${item.name}`}
                    onclick={() => ondownload?.(item)}
                    ><IconDownload aria-hidden="true" /></IconButton
                >
            {/if}
            <IconButton
                size="xs"
                title={deleteLabel}
                {disabled}
                loading={working === FileActionKind.Delete}
                loadingAriaLabel={`Deleting ${item.name}`}
                onclick={() => ondelete?.(item)}><IconDelete aria-hidden="true" /></IconButton
            >
        {/if}
    {:else if trash}
        <Button
            variant="text"
            size="xs"
            title={restoreLabel}
            {disabled}
            loading={working === FileActionKind.Restore}
            loadingAriaLabel={`Restoring ${item.name}`}
            onclick={() => onrestore?.(item)}
        >
            {#snippet start()}<IconRestore aria-hidden="true" />{/snippet}
            Restore
        </Button>
        <Button
            variant="text"
            size="xs"
            title={deleteForeverLabel}
            {disabled}
            loading={working === FileActionKind.DeleteForever}
            loadingAriaLabel={`Deleting ${item.name} forever`}
            onclick={() => ondeleteforever?.(item)}
        >
            {#snippet start()}<IconDeleteForever aria-hidden="true" />{/snippet}
            Delete forever
        </Button>
    {:else}
        {#if canRestore}
            <Button
                variant="text"
                size="xs"
                title={restoreLabel}
                {disabled}
                loading={working === FileActionKind.Restore}
                loadingAriaLabel={`Restoring ${item.name}`}
                onclick={() => onrestore?.(item)}
            >
                {#snippet start()}<IconRestore aria-hidden="true" />{/snippet}
                Restore
            </Button>
        {/if}
        {#if item.complete}
            <Button
                variant="text"
                size="xs"
                title={`Download ${item.name}`}
                {disabled}
                loading={working === FileActionKind.Download}
                loadingAriaLabel={`Downloading ${item.name}`}
                onclick={() => ondownload?.(item)}
            >
                {#snippet start()}<IconDownload aria-hidden="true" />{/snippet}
                Download
            </Button>
        {/if}
        <Button
            variant="text"
            size="xs"
            title={deleteLabel}
            {disabled}
            loading={working === FileActionKind.Delete}
            loadingAriaLabel={`Deleting ${item.name}`}
            onclick={() => ondelete?.(item)}
        >
            {#snippet start()}<IconDelete aria-hidden="true" />{/snippet}
            {deleteButtonLabel}
        </Button>
    {/if}
</div>

<style>
    .file-actions :global(.np-button) {
        font-size: 12px;
        --np-button-padding: 8px;
        --np-button-gap: 4px;
        --np-text-button-label-text-color: var(--app-muted);
    }
</style>
