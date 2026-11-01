<script lang="ts">
    import { Card } from 'noph-ui';
    import type { FileActionKind } from '@madkarmaa/phodrive-core/models';

    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import { fileType } from '@madkarmaa/phodrive-core/files';
    import FileActions from '#components/FileActions.svelte';
    import FileIncompleteWarning from '#components/FileIncompleteWarning.svelte';
    import IconDescriptionOutline from '~icons/material-symbols/description-outline';

    interface Props {
        item: FileGroup;
        disabled: boolean;
        working: FileActionKind | null;
        showOwner?: boolean;
        partial?: boolean;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
        onrestore: (item: FileGroup) => void;
    }

    let {
        item,
        disabled,
        working,
        showOwner = false,
        partial = false,
        ondownload,
        ondelete,
        onrestore
    }: Props = $props();
</script>

<Card type="text" variant="filled" class="file-card">
    <div class="flex h-12 min-w-0 items-center gap-3 px-3">
        <IconDescriptionOutline aria-hidden="true" class="size-5 shrink-0 text-muted" />
        <h3 class="min-w-0 flex-1 truncate text-sm font-medium" title={item.name}>{item.name}</h3>
    </div>
    {#if showOwner}
        <p class="m-0 truncate px-3 pb-1 text-xs text-muted" title={item.email}>{item.email}</p>
    {/if}

    <div
        class="file-preview mx-2 mb-2 grid place-items-center rounded bg-preview"
        aria-hidden="true"
    >
        <div class="relative size-22 text-muted">
            <IconDescriptionOutline class="size-22" />
            <span
                class="absolute top-13 left-3 w-16 truncate rounded bg-preview text-center text-xs font-medium"
                >{fileType(item.name)}</span
            >
        </div>
    </div>

    {#if !item.complete}
        <div class="px-3 pb-2">
            <FileIncompleteWarning {item} {partial} />
        </div>
    {/if}

    <div class="flex justify-end px-2 pb-2">
        <FileActions
            {item}
            {disabled}
            {working}
            {partial}
            shortDelete
            {ondownload}
            {ondelete}
            {onrestore}
        />
    </div>
</Card>

<style>
    :global(:root .file-card.np-card-container) {
        width: 100%;
        container-type: inline-size;
        min-width: 0;
        overflow: hidden;
        --np-filled-card-container-color: var(--app-card);
        --np-filled-card-container-shape: 12px;
    }

    :global(:root .file-card.np-card-container .np-card-content) {
        margin: 0;
        gap: 0;
        min-width: 0;
        width: 100%;
    }
    .file-preview {
        height: calc(100cqi - 96px);
        min-height: 150px;
    }
</style>
