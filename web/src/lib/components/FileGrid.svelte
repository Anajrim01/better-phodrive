<script lang="ts">
    import { Button } from 'noph-ui';
    import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
    import type { FileGroup, FileAction, FolderEntry } from '@madkarmaa/phodrive-core/files';
    import FileCardGrid from '#components/FileCardGrid.svelte';
    import FileGridStatus from '#components/FileGridStatus.svelte';
    import FileList from '#components/FileList.svelte';
    import FolderTiles from '#components/FolderTiles.svelte';

    interface Props {
        files: FileGroup[];
        folders?: FolderEntry[];
        layout: FileLayout;
        sort: FileSort;
        loading: boolean;
        loadFailed: boolean;
        filtered: boolean;
        hasFiles: boolean;
        hasMore: boolean;
        disabled: boolean;
        foldersDisabled?: boolean;
        action: FileAction | null;
        ondownload: (item: FileGroup) => void;
        onshare?: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
        onrestoretrashed?: (item: FileGroup) => void;
        onopenfolder?: (path: string) => void;
        onsharefolder?: (path: string) => void;
        onmore: () => void;
    }

    let {
        files,
        folders = [],
        layout,
        sort = $bindable(),
        loading,
        loadFailed,
        filtered,
        hasFiles,
        hasMore,
        disabled,
        foldersDisabled = false,
        action,
        ondownload,
        onshare,
        ondelete,
        onrestoretrashed,
        onopenfolder,
        onsharefolder,
        onmore
    }: Props = $props();
</script>

<section class="flex min-h-0 flex-1 flex-col" aria-labelledby="files-heading">
    <FolderTiles
        {folders}
        disabled={foldersDisabled}
        onopen={(path) => onopenfolder?.(path)}
        onshare={onsharefolder}
    />

    {#if !files.length && !folders.length}
        <FileGridStatus {loading} {loadFailed} filteredOut={filtered && hasFiles} />
    {:else if layout === FileLayout.List}
        <FileList
            {files}
            bind:sort
            {disabled}
            {action}
            showFolder={filtered}
            {ondownload}
            {onshare}
            {ondelete}
            {onrestoretrashed}
        />
    {:else}
        <FileCardGrid
            {files}
            {disabled}
            {action}
            {ondownload}
            {onshare}
            {ondelete}
            {onrestoretrashed}
        />
    {/if}

    {#if hasMore}
        <div class="mt-6 flex justify-center">
            <Button
                variant="outlined"
                {loading}
                loadingAriaLabel="Loading more files"
                {disabled}
                onclick={onmore}
            >
                Load more
            </Button>
        </div>
    {/if}
</section>
