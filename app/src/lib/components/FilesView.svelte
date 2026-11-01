<script lang="ts">
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { FileGroup, FolderEntry } from '@madkarmaa/phodrive-core/files';
    import type { DriveController } from '#browser/drive/index.svelte';
    import type { MenuAnchor } from '#browser/drive/menu-types';
    import FileFilters from '#components/FileFilters.svelte';
    import GroupListingStatus from '#components/GroupListingStatus.svelte';
    import FileGrid from '#components/FileGrid.svelte';
    import LayoutToggle from '#components/LayoutToggle.svelte';
    import FileDrop from '#components/FileDrop.svelte';

    interface Props {
        drive: DriveController;
        actionsDisabled: boolean;
        selected: ReadonlySet<string>;
        onselect: (item: FileGroup, event: MouseEvent | KeyboardEvent) => void;
        onselectall: (select: boolean) => void;
        oncontextselect: (item: FileGroup) => void;
        onselectionmenu: (anchor: MenuAnchor) => void;
        onupload: (files: File[]) => void;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
        onrestore: (item: FileGroup) => void;
        onfilemenu: (item: FileGroup, anchor: MenuAnchor) => void;
        onfoldermenu: (folder: FolderEntry, anchor: MenuAnchor) => void;
    }

    let {
        drive,
        actionsDisabled,
        selected,
        onselect,
        onselectall,
        oncontextselect,
        onselectionmenu,
        onupload,
        ondownload,
        ondelete,
        onrestore,
        onfilemenu,
        onfoldermenu
    }: Props = $props();
</script>

<div class="flex flex-1 flex-col" in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
    <div class="workspace-heading">
        <h1 id="files-heading" class="min-w-0">
            <span class="crumbs">
                <button
                    type="button"
                    class="crumb"
                    class:current={!drive.library.folder}
                    aria-current={!drive.library.folder ? 'page' : undefined}
                    onclick={() => drive.library.openFolder('')}
                >
                    My files
                </button>
                {#each drive.library.trail as crumb (crumb.path)}
                    <span class="crumb-separator" aria-hidden="true">/</span>
                    <button
                        type="button"
                        class="crumb"
                        class:current={drive.library.folder === crumb.path}
                        aria-current={drive.library.folder === crumb.path ? 'page' : undefined}
                        onclick={() => drive.library.openFolder(crumb.path)}
                    >
                        {crumb.name}
                    </button>
                {/each}
            </span>
            <span class="text-subtle tabular-nums">({drive.library.visibleFiles.length})</span>
        </h1>
        <LayoutToggle bind:layout={drive.settings.fileLayout} />
    </div>

    {#if drive.groupMode.target}
        {@const target = drive.groupMode.target}
        <GroupListingStatus
            groupName={target.group.name}
            total={target.group.accounts.length}
            accounts={drive.library.accounts}
        />
    {/if}

    <FileFilters
        types={drive.library.availableTypes}
        bind:type={drive.library.typeFilter}
        bind:days={drive.library.modifiedDays}
        bind:sort={drive.settings.fileSort}
    />
    <FileDrop
        disabled={actionsDisabled ||
            drive.library.loading ||
            drive.confirmOpen ||
            drive.accountMenuOpen}
        {onupload}
    >
        <FileGrid
            files={drive.library.visibleFiles}
            folders={drive.library.filtering ? [] : drive.library.folders}
            layout={drive.settings.fileLayout}
            bind:sort={drive.settings.fileSort}
            loading={drive.library.loading}
            loadFailed={drive.library.loadFailed}
            filtered={drive.library.filtering}
            hasFiles={!!drive.library.files.length}
            hasMore={!!drive.library.nextPageToken}
            disabled={actionsDisabled || drive.library.loading}
            showFolder={drive.library.filtering}
            showOwner={drive.groupMode.target !== null}
            action={drive.fileAction}
            {selected}
            {onselect}
            {onselectall}
            {oncontextselect}
            {onselectionmenu}
            onopenfolder={(path) => drive.library.openFolder(path)}
            {ondownload}
            {ondelete}
            {onrestore}
            {onfilemenu}
            {onfoldermenu}
            onmore={() => {
                void drive.library.load(false);
            }}
        />
    </FileDrop>
</div>

<style>
    .crumbs {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: 8px;
        row-gap: 0;
    }

    .crumb {
        max-width: 100%;
        min-width: 0;
        padding: 4px 0;
        overflow: hidden;
        border-radius: 8px;
        color: var(--app-muted);
        font: inherit;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition: color var(--np-motion-standard-fast-effects);
    }

    .crumb:hover {
        color: var(--app-text);
        text-decoration: underline;
        text-underline-offset: 6px;
    }

    .crumb.current {
        color: var(--app-text);
    }

    .crumb:focus-visible {
        outline: 3px solid var(--app-primary);
        outline-offset: 2px;
    }

    .crumb-separator {
        color: var(--app-subtle);
    }

    @media (width < 800px) {
        .workspace-heading {
            height: auto;
            min-height: 40px;
            align-items: flex-start;
        }
    }
</style>
