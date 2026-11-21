<script lang="ts">
    import { Button } from 'noph-ui';
    import { setContext, tick } from 'svelte';
    import { FILE_LOCATION_CONTROLS } from '#browser/drive/file-locations.svelte';
    import MoveFilesPanel from '#components/MoveFilesPanel.svelte';
    import { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { DriveController } from '#browser/drive/index.svelte';
    import type { DriveShareController } from '#browser/drive/share.svelte';
    import FileDrop from '#components/FileDrop.svelte';
    import FileFilters from '#components/FileFilters.svelte';
    import FileGrid from '#components/FileGrid.svelte';
    import LayoutToggle from '#components/LayoutToggle.svelte';
    import { folderLabel } from '#lib/folders';

    interface Props {
        drive: DriveController;
        share: DriveShareController | null;
        /** An upload or file action is running. */
        working: boolean;
        /** An upload is not allowed for the current drive context. */
        uploadDisabled: boolean;
        onupload: (files: File[]) => void;
    }

    let { drive, share, working, uploadDisabled, onupload }: Props = $props();

    const { library, settings, context, locations } = $derived(drive);
    setContext(FILE_LOCATION_CONTROLS, () => locations);
    let moveButton = $state<HTMLElement>();
    let filesHeading = $state<HTMLHeadingElement>();

    async function closeMove() {
        locations.closeMove();
        await tick();
        (moveButton ?? filesHeading)?.focus();
    }
    const disabled = $derived(working || library.loading);
    const foldersDisabled = $derived(library.loading && library.files.length === 0);
    const filtered = $derived(!!(library.searchTerm || library.typeFilter || library.modifiedDays));
    const heading = $derived(
        context.current?.kind === 'group' ? context.current.group.name : 'My files'
    );
    const destination = $derived(folderLabel(heading, library.folder));
</script>

<div class="flex flex-1 flex-col" in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
    <div class="workspace-heading">
        <h1
            id="files-heading"
            bind:this={filesHeading}
            tabindex="-1"
            class="flex min-w-0 flex-wrap items-center gap-1"
        >
            <button
                type="button"
                class="max-w-[min(22rem,100%)] truncate rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                aria-current={!library.folder ? 'page' : undefined}
                onclick={() => library.openFolder('', 'ancestor')}
            >
                {heading}
            </button>
            {#each library.trail as crumb (crumb.path)}
                <span class="text-subtle" aria-hidden="true">/</span>
                <button
                    type="button"
                    class="max-w-[min(22rem,100%)] truncate rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    aria-current={library.folder === crumb.path ? 'page' : undefined}
                    onclick={() => library.openFolder(crumb.path, 'ancestor')}
                >
                    {crumb.name}
                </button>
            {/each}
            <span class="text-subtle tabular-nums">({library.visibleFiles.length})</span>
        </h1>
        <LayoutToggle bind:layout={settings.fileLayout} />
    </div>

    <FileFilters
        types={library.availableTypes}
        bind:type={library.typeFilter}
        bind:days={library.modifiedDays}
        bind:sort={settings.fileSort}
    />
    {#if locations.selected.length}
        <div class="flex flex-wrap items-center gap-2 border-y border-border py-2">
            <span class="mr-auto text-sm" role="status">{locations.selected.length} selected</span>
            {#if !locations.moving}
                <Button
                    variant="text"
                    size="xs"
                    disabled={locations.disabled}
                    bind:element={moveButton}
                    onclick={() => locations.startMove()}
                >
                    Move selected
                </Button>
                <Button
                    variant="text"
                    size="xs"
                    disabled={locations.disabled}
                    onclick={() => locations.clearSelection()}
                >
                    Clear selection
                </Button>
            {/if}
        </div>
    {/if}

    <div
        class={locations.moving
            ? 'grid flex-1 items-start gap-4 min-[1230px]:grid-cols-[minmax(0,1fr)_18rem]'
            : 'flex-1'}
    >
        <div class="min-w-0">
            <FileDrop
                disabled={disabled ||
                    uploadDisabled ||
                    drive.confirmOpen ||
                    drive.accountMenuOpen ||
                    locations.moving}
                {destination}
                {onupload}
            >
                <FileGrid
                    files={library.visibleFiles}
                    folders={library.folders}
                    layout={settings.fileLayout}
                    bind:sort={settings.fileSort}
                    loading={library.loading}
                    loadFailed={library.loadFailed}
                    {filtered}
                    hasFiles={!!library.files.length}
                    hasMore={library.hasMore}
                    {disabled}
                    {foldersDisabled}
                    action={drive.fileAction}
                    onopenfolder={(path) => library.openFolder(path)}
                    ondownload={(item) => {
                        void drive.actOnFile(item, FileActionKind.Download);
                    }}
                    onshare={share ? (item) => share.requestFile(item) : undefined}
                    onsharefolder={share ? (path) => share.requestFolder(path) : undefined}
                    ondelete={(item) => drive.requestDelete(item)}
                    onrestoretrashed={(item) => {
                        if (item.trashedChunks?.length)
                            void drive.actOnFile(
                                { ...item, chunks: item.trashedChunks },
                                FileActionKind.Restore
                            );
                    }}
                    onmore={() => {
                        void library.load(false);
                    }}
                />
            </FileDrop>
        </div>
        {#if locations.moving}
            <div class="min-w-0 max-[1229px]:order-first">
                <MoveFilesPanel
                    {locations}
                    hasMore={library.hasMore}
                    loading={library.loading}
                    onmore={() => void library.load(false)}
                    onclose={closeMove}
                />
            </div>
        {/if}
    </div>
</div>
