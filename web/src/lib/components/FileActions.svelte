<script lang="ts">
    import { Button, IconButton } from 'noph-ui';
    import { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import IconDownload from '~icons/material-symbols/download';
    import IconShare from '~icons/material-symbols/share';
    import IconDelete from '~icons/material-symbols/delete-outline';
    import IconRestore from '~icons/material-symbols/restore-from-trash';
    import IconDeleteForever from '~icons/material-symbols/delete-forever';

    interface Props {
        item: FileGroup;
        disabled: boolean;
        working: FileActionKind | null;
        compact?: boolean;
        trash?: boolean;
        ondownload?: (item: FileGroup) => void;
        onshare?: (item: FileGroup) => void;
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
        ondownload,
        onshare,
        ondelete,
        onrestore,
        ondeleteforever
    }: Props = $props();
</script>

<div class="file-actions flex shrink-0 flex-wrap items-center justify-end">
    {#if trash}
        {#if onrestore}
            <IconButton
                size="xs"
                title={`Restore ${item.name}`}
                {disabled}
                loading={working === FileActionKind.Restore}
                loadingAriaLabel={`Restoring ${item.name}`}
                onclick={() => onrestore?.(item)}><IconRestore aria-hidden="true" /></IconButton
            >
        {/if}
        {#if ondeleteforever}
            <IconButton
                size="xs"
                title={`Delete forever: ${item.name}`}
                {disabled}
                loading={working === FileActionKind.DeleteForever}
                loadingAriaLabel={`Deleting ${item.name} forever`}
                onclick={() => ondeleteforever?.(item)}
                ><IconDeleteForever aria-hidden="true" /></IconButton
            >
        {/if}
    {:else if compact}
        {#if ondownload}
            <IconButton
                size="xs"
                title={`Download ${item.name}`}
                disabled={disabled || !item.complete}
                loading={working === FileActionKind.Download}
                loadingAriaLabel={`Downloading ${item.name}`}
                onclick={() => ondownload?.(item)}><IconDownload aria-hidden="true" /></IconButton
            >
        {/if}
        {#if onshare}
            <IconButton
                size="xs"
                title={`Share ${item.name}`}
                disabled={disabled ||
                    !item.complete ||
                    item.trashed ||
                    !!item.trashedChunks?.length}
                onclick={() => onshare?.(item)}><IconShare aria-hidden="true" /></IconButton
            >
        {/if}
        {#if ondelete}
            <IconButton
                size="xs"
                title={`Delete ${item.name}`}
                {disabled}
                loading={working === FileActionKind.Delete}
                loadingAriaLabel={`Deleting ${item.name}`}
                onclick={() => ondelete?.(item)}><IconDelete aria-hidden="true" /></IconButton
            >
        {/if}
    {:else}
        {#if ondownload}
            <Button
                variant="text"
                size="xs"
                disabled={disabled || !item.complete}
                loading={working === FileActionKind.Download}
                loadingAriaLabel={`Downloading ${item.name}`}
                onclick={() => ondownload?.(item)}
            >
                {#snippet start()}<IconDownload aria-hidden="true" />{/snippet}
                Download
            </Button>
        {/if}
        {#if onshare}
            <Button
                variant="text"
                size="xs"
                disabled={disabled ||
                    !item.complete ||
                    item.trashed ||
                    !!item.trashedChunks?.length}
                onclick={() => onshare?.(item)}
            >
                {#snippet start()}<IconShare aria-hidden="true" />{/snippet}
                Share
            </Button>
        {/if}
        {#if ondelete}
            <Button
                variant="text"
                size="xs"
                {disabled}
                loading={working === FileActionKind.Delete}
                loadingAriaLabel={`Deleting ${item.name}`}
                onclick={() => ondelete?.(item)}
            >
                {#snippet start()}<IconDelete aria-hidden="true" />{/snippet}
                Delete
            </Button>
        {/if}
    {/if}
</div>

<style>
    .file-actions :global(.np-button) {
        font-size: 12px;
        --np-button-padding: 7px;
        --np-button-gap: 4px;
        --np-button-icon-size: 16px;
    }
</style>
