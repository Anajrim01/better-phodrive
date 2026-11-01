<script lang="ts">
    import {
        incompleteFileMessage,
        missingChunks,
        type FileGroup
    } from '@madkarmaa/phodrive-core/files';
    import IconWarning from '~icons/material-symbols/warning';

    interface Props {
        item: FileGroup;
    }

    let { item }: Props = $props();
    const message = $derived(incompleteFileMessage(item));
    const missing = $derived(
        item.chunkCount === null ? null : missingChunks(item.chunks, item.chunkCount)
    );
    const label = $derived(
        item.chunkCount === null || missing === null
            ? 'Incomplete file'
            : `${missing} of ${item.chunkCount} chunks missing`
    );
</script>

<span class="file-incomplete flex min-w-0 items-center gap-1 text-xs text-error" title={message}>
    <IconWarning aria-hidden="true" class="size-4 shrink-0" />
    <span class="truncate">{label}</span>
</span>
