<script lang="ts">
    import { Button, LoadingIndicator } from 'noph-ui';
    import { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { DriveController } from '#browser/drive/index.svelte';
    import FileList from '#components/FileList.svelte';

    interface Props {
        drive: DriveController;
        working: boolean;
    }

    let { drive, working }: Props = $props();

    const { library, settings, context } = $derived(drive);
    const disabled = $derived(working || library.loading);
    const showOwner = $derived(context.current?.kind === 'group');
    const filteredOut = $derived(
        !!library.searchTerm && library.trashFiles.length > 0 && library.trashVisible.length === 0
    );
</script>

<div class="flex flex-1 flex-col" in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
    <div class="workspace-heading">
        <div>
            <h1 id="trash-heading">
                Trash <span class="text-subtle tabular-nums">({library.trashVisible.length})</span>
            </h1>
            <p class="mt-1 text-sm text-muted">Files here are in Google Photos trash.</p>
        </div>
    </div>

    {#if !library.trashVisible.length}
        <div class="grid place-items-center px-6 py-12 text-center text-sm text-muted">
            {#if library.loading}
                <LoadingIndicator aria-label="Loading Google Photos trash" />
            {:else if library.loadFailed}
                <p>Use Refresh to try loading your trash again.</p>
            {:else if filteredOut}
                <p>No files match your search.</p>
            {:else}
                <p>Trash is empty.</p>
            {/if}
        </div>
    {:else}
        <FileList
            files={library.trashVisible}
            bind:sort={settings.fileSort}
            {disabled}
            action={drive.fileAction}
            headingId="trash-heading"
            showFolder
            {showOwner}
            trash
            onrestore={(item) => {
                void drive.actOnFile(item, FileActionKind.Restore);
            }}
            ondeleteforever={(item) => drive.requestDeleteForever(item)}
        />
    {/if}

    {#if library.hasMore}
        <div class="mt-6 flex justify-center">
            <Button
                variant="outlined"
                loading={library.loading}
                loadingAriaLabel="Loading more trash files"
                {disabled}
                onclick={() => {
                    void library.load(false);
                }}
            >
                Load more
            </Button>
        </div>
    {/if}
</div>
