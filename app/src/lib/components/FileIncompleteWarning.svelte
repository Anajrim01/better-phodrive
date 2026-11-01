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
        trash?: boolean;
    }

    let { item, partial = false, trash = false }: Props = $props();
    const message = $derived(incompleteFileMessage(item));
    const missing = $derived(
        item.chunkCount === null ? null : missingChunks(item.chunks, item.chunkCount)
    );
    const trashed = $derived(new Set(item.trashedChunks.map((chunk) => chunk.chunkIndex)).size);
    const label = $derived(
        item.chunkCount === null
            ? 'Incomplete file'
            : !item.complete
              ? `${missing} of ${item.chunkCount} chunks ${partial ? 'not loaded' : 'missing'}`
              : `${trashed} chunk${trashed === 1 ? '' : 's'} in Trash`
    );
    const title = $derived(
        item.complete
            ? 'These chunks are in Trash. Restore them to bring them back.'
            : partial
              ? 'Load more to check the rest of this file.'
              : message
    );
</script>

<span
    class="file-incomplete flex min-w-0 items-center gap-1 text-xs"
    class:text-error={!partial}
    class:text-muted={partial}
    {title}
>
    <IconWarning aria-hidden="true" class="size-4 shrink-0" />
    <span class="truncate">{label}</span>
    {#if !partial && !trash}<span class="sr-only">This file cannot be downloaded.</span>{/if}
</span>
