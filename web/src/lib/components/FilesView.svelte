<script lang="ts">
    import { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { DriveController } from '#browser/drive/index.svelte';
    import FileDrop from '#components/FileDrop.svelte';
    import FileFilters from '#components/FileFilters.svelte';
    import FileGrid from '#components/FileGrid.svelte';
    import LayoutToggle from '#components/LayoutToggle.svelte';
    import { folderLabel } from '#lib/folders';

    interface Props {
        drive: DriveController;
        /** An upload or file action is running. */
        working: boolean;
        /** An upload is not allowed for the current drive context. */
        uploadDisabled: boolean;
        onupload: (files: File[]) => void;
    }

    let { drive, working, uploadDisabled, onupload }: Props = $props();

    const { library, settings, context } = $derived(drive);
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
        <h1 id="files-heading" class="flex min-w-0 flex-wrap items-center gap-1">
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
    <FileDrop
        disabled={disabled || uploadDisabled || drive.confirmOpen || drive.accountMenuOpen}
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
            ondelete={(item) => {
                drive.confirmTarget = item;
                drive.confirmOpen = true;
            }}
            onmore={() => {
                void library.load(false);
            }}
        />
    </FileDrop>
</div>
