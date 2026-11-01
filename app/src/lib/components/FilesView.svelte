<script lang="ts">
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { FileGroup, FolderEntry } from '@madkarmaa/phodrive-core/files';
    import type { DriveController } from '#browser/drive/index.svelte';
    import { FILE_DRAG_TYPE } from '#browser/drive/drag-types';
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
        onselect: (
            item: FileGroup,
            event: MouseEvent | KeyboardEvent,
            mode?: 'toggle' | 'point'
        ) => void;
        onselectall: (select: boolean) => void;
        oncontextselect: (item: FileGroup) => void;
        onselectionmenu: (anchor: MenuAnchor) => void;
        onmarquee: (keys: ReadonlySet<string>) => void;
        onmovefiles: (destination: string) => void;
        dragging: boolean;
        onstartdrag: (item: FileGroup, event: DragEvent) => void;
        onenddrag: () => void;
        onupload: (files: File[]) => void;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
        onrestore: (item: FileGroup) => void;
        onopenpreview: (item: FileGroup, trigger: HTMLElement) => void;
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
        onmarquee,
        onmovefiles,
        dragging,
        onstartdrag,
        onenddrag,
        onupload,
        ondownload,
        ondelete,
        onrestore,
        onopenpreview,
        onfilemenu,
        onfoldermenu
    }: Props = $props();

    let dropCrumb = $state<string | null>(null);

    function canDrop(path: string, event: DragEvent): boolean {
        return (
            path !== drive.library.folder &&
            (dragging || event.dataTransfer?.types.includes(FILE_DRAG_TYPE) === true)
        );
    }

    function crumbOver(path: string, event: DragEvent): void {
        if (!canDrop(path, event)) return;

        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        dropCrumb = path;
    }

    function crumbLeave(path: string, event: DragEvent): void {
        if (
            event.currentTarget instanceof Node &&
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
        )
            return;
        if (dropCrumb === path) dropCrumb = null;
    }

    function crumbDrop(path: string, event: DragEvent): void {
        if (!canDrop(path, event)) return;

        event.preventDefault();
        dropCrumb = null;
        onmovefiles(path);
    }
</script>

<div class="flex flex-1 flex-col" in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
    <div class="workspace-heading">
        <h1 id="files-heading" class="min-w-0">
            <span class="crumbs">
                <button
                    type="button"
                    class="crumb"
                    class:current={!drive.library.folder}
                    class:selection-drop={dropCrumb === ''}
                    aria-current={!drive.library.folder ? 'page' : undefined}
                    onclick={() => drive.library.openFolder('')}
                    ondragover={(event) => crumbOver('', event)}
                    ondragleave={(event) => crumbLeave('', event)}
                    ondrop={(event) => crumbDrop('', event)}
                >
                    My files
                </button>
                {#each drive.library.trail as crumb (crumb.path)}
                    <span class="crumb-separator" aria-hidden="true">/</span>
                    <button
                        type="button"
                        class="crumb"
                        class:current={drive.library.folder === crumb.path}
                        class:selection-drop={dropCrumb === crumb.path}
                        aria-current={drive.library.folder === crumb.path ? 'page' : undefined}
                        onclick={() => drive.library.openFolder(crumb.path)}
                        ondragover={(event) => crumbOver(crumb.path, event)}
                        ondragleave={(event) => crumbLeave(crumb.path, event)}
                        ondrop={(event) => crumbDrop(crumb.path, event)}
                    >
                        {crumb.name}
                    </button>
                {/each}
                <span class="text-subtle tabular-nums">({drive.library.visibleFiles.length})</span>
            </span>
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
            {onmarquee}
            {onmovefiles}
            {dragging}
            {onstartdrag}
            {onenddrag}
            onopenfolder={(path) => drive.library.openFolder(path)}
            {ondownload}
            {ondelete}
            {onrestore}
            {onopenpreview}
            {onfilemenu}
            {onfoldermenu}
            onmore={() => {
                void drive.library.load(false);
            }}
        />
    </FileDrop>
</div>

<style>
    .workspace-heading {
        height: auto;
        min-height: 40px;
        align-items: flex-start;
        padding-block: 4px;
    }

    .workspace-heading h1 {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2px 8px;
        min-width: 0;
    }

    .crumbs {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: 8px;
        row-gap: 0;
        min-width: 0;
        max-width: 100%;
    }

    .crumb {
        max-width: min(22rem, 100%);
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

    .crumb.selection-drop {
        background: color-mix(in srgb, var(--app-primary) 12%, transparent);
        box-shadow: inset 0 0 0 2px var(--app-primary);
        color: var(--app-text);
    }

    .crumb-separator {
        color: var(--app-subtle);
    }
</style>
