<script lang="ts">
    import { FileSort } from '@madkarmaa/phodrive-core/models';
    import { sortFiles, type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
    import FileList from '#components/FileList.svelte';

    interface Props {
        files: FileGroup[];
        sort: FileSort;
        disabled: boolean;
        action: FileAction | null;
        showOwner?: boolean;
        onrestore: (item: FileGroup) => void;
        ondeleteforever: (item: FileGroup) => void;
    }

    let {
        files,
        sort = $bindable(),
        disabled,
        action,
        showOwner = false,
        onrestore,
        ondeleteforever
    }: Props = $props();

    const sorted = $derived(sortFiles(files, sort));
</script>

<div class="workspace-heading">
    <h1 id="trash-heading" class="min-w-0">
        Trash <span class="text-subtle tabular-nums">({files.length})</span>
    </h1>
</div>
<p class="m-0 mb-6 max-w-2xl text-sm text-muted">
    Restore files to Google Photos or delete them forever. Trashed files keep their original name,
    size, date and folder.
</p>

{#if files.length}
    <FileList
        files={sorted}
        bind:sort
        {disabled}
        {action}
        showFolder
        {showOwner}
        trash
        headingId="trash-heading"
        {onrestore}
        {ondeleteforever}
    />
{:else}
    <div class="grid min-h-90 flex-1 place-items-center px-6 py-12 text-center text-sm text-muted">
        <p>Trash is empty</p>
    </div>
{/if}
