<script lang="ts">
    import { Button, LoadingIndicator } from 'noph-ui';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import { FileSort } from '@madkarmaa/phodrive-core/models';
    import { sortFiles, type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
    import FileList from '#components/FileList.svelte';

    interface Props {
        files: FileGroup[];
        sort: FileSort;
        disabled: boolean;
        loading: boolean;
        loadFailed: boolean;
        hasMore: boolean;
        action: FileAction | null;
        showOwner?: boolean;
        onrestore: (item: FileGroup) => void;
        ondeleteforever: (item: FileGroup) => void;
        onmore: () => void;
    }

    let {
        files,
        sort = $bindable(),
        disabled,
        loading,
        loadFailed,
        hasMore,
        action,
        showOwner = false,
        onrestore,
        ondeleteforever,
        onmore
    }: Props = $props();

    const sorted = $derived(sortFiles(files, sort));
</script>

<div class="flex flex-1 flex-col" in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
    <div class="workspace-heading">
        <h1 id="trash-heading" class="min-w-0">
            Trash <span class="text-subtle tabular-nums">({files.length})</span>
        </h1>
    </div>
    <p class="m-0 mb-6 max-w-2xl text-sm text-muted">
        Files here are in Google Photos trash. Restore them to My files or delete them forever.
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
            partial={hasMore}
            headingId="trash-heading"
            {onrestore}
            {ondeleteforever}
        />
    {:else}
        <div
            class="grid min-h-90 flex-1 place-items-center px-6 py-12 text-center text-sm text-muted"
        >
            {#if loading}
                <LoadingIndicator aria-label="Loading trash" />
            {:else if loadFailed}
                <p>Use Refresh to load your files again</p>
            {:else}
                <p role="status">Trash is empty</p>
            {/if}
        </div>
    {/if}

    {#if hasMore}
        <div class="mt-6 flex justify-center">
            <Button
                variant="outlined"
                {loading}
                loadingAriaLabel="Loading more trash"
                {disabled}
                onclick={onmore}
            >
                Load more
            </Button>
        </div>
    {/if}
</div>
