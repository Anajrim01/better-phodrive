<script lang="ts">
    import {
        incompleteFileMessage,
        missingChunks,
        type FileGroup
    } from '@madkarmaa/phodrive-core/files';
    import IconWarning from '~icons/material-symbols/warning';

    interface Props {
        item: FileGroup;
        partial?: boolean;
    }

    let { item, partial = false }: Props = $props();
    const message = $derived(incompleteFileMessage(item));
    const missing = $derived(
        item.chunkCount === null ? null : missingChunks(item.chunks, item.chunkCount)
    );
    const label = $derived(
        item.chunkCount === null || missing === null || (!partial && missing === 0)
            ? 'Incomplete file'
            : `${missing} of ${item.chunkCount} chunks ${partial ? 'not loaded' : 'missing'}`
    );
</script>

<span
    class="file-incomplete flex min-w-0 items-center gap-1 text-xs"
    class:text-error={!partial}
    class:text-muted={partial}
    title={partial ? 'Load more to check the rest of this file.' : message}
>
    <IconWarning aria-hidden="true" class="size-4 shrink-0" />
    <span class="truncate">{label}</span>
    {#if !partial}<span class="sr-only">This file cannot be downloaded.</span>{/if}
</span>
