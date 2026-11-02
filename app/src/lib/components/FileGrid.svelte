<script lang="ts">
    import { Button, LoadingIndicator } from 'noph-ui';
    import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
    import {
        fileActionKind,
        type FileAction,
        type FileGroup,
        type FolderEntry
    } from '@madkarmaa/phodrive-core/files';
    import { fileKey } from '@madkarmaa/phodrive-core/files';
    import FileCard from '#components/FileCard.svelte';
    import FileList from '#components/FileList.svelte';
    import MarqueeSelect from '#components/MarqueeSelect.svelte';
    import EmptyFiles from '#components/EmptyFiles.svelte';
    import FolderTiles from '#components/FolderTiles.svelte';
    import { fileArrowStep, focusedFileIndex } from '#lib/file-item-keys';
    import { createFileFocus } from '#lib/file-focus.svelte';
    import { createWindowRows } from '#lib/virtual-window.svelte';
    import { GRID_GAP, gridColumnCount, gridRowCount } from '#lib/file-window';
    import type { MenuAnchor } from '#browser/drive/menu-types';

    interface Props {
        files: FileGroup[];
        folders: FolderEntry[];
        layout: FileLayout;
        sort: FileSort;
        loading: boolean;
        loadFailed: boolean;
        filtered: boolean;
        hasFiles: boolean;
        hasMore: boolean;
        actionsDisabled: boolean;
        browseDisabled?: boolean;
        showFolder: boolean;
        showOwner?: boolean;
        action?: FileAction | null;
        selected?: ReadonlySet<string>;
        onselect?: (
            item: FileGroup,
            event: MouseEvent | KeyboardEvent,
            mode?: 'toggle' | 'point'
        ) => void;
        onselectall?: (select: boolean) => void;
        oncontextselect?: (item: FileGroup) => void;
        onselectionmenu?: (anchor: MenuAnchor) => void;
        onmarquee?: (keys: ReadonlySet<string>) => void;
        onmovefiles: (destination: string) => void;
        dragging: boolean;
        onstartdrag: (item: FileGroup, event: DragEvent) => void;
        onenddrag: () => void;
        onopenfolder: (path: string) => void;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
        onrestore: (item: FileGroup) => void;
        onopenpreview?: (item: FileGroup, trigger: HTMLElement) => void;
        onfilemenu: (item: FileGroup, anchor: MenuAnchor) => void;
        onfoldermenu: (folder: FolderEntry, anchor: MenuAnchor) => void;
        onmore: () => void;
    }

    let {
        files,
        folders,
        layout,
        sort = $bindable(),
        loading,
        loadFailed,
        filtered,
        hasFiles,
        hasMore,
        actionsDisabled,
        browseDisabled = false,
        showFolder,
        showOwner = false,
        action = null,
        selected = new Set<string>(),
        onselect,
        onselectall,
        oncontextselect,
        onselectionmenu,
        onmarquee,
        onmovefiles,
        dragging,
        onstartdrag,
        onenddrag,
        onopenfolder,
        ondownload,
        ondelete,
        onrestore,
        onopenpreview,
        onfilemenu,
        onfoldermenu,
        onmore
    }: Props = $props();
    const selectedCount = $derived(
        files.reduce((count, item) => count + (selected.has(fileKey(item)) ? 1 : 0), 0)
    );
    const multipleSelected = $derived(selectedCount > 1);
    let grid = $state<HTMLDivElement>();
    let gridWidth = $state(0);
    let dragKey = $state<string | null>(null);
    const columns = $derived(gridColumnCount(gridWidth));
    const rowCount = $derived(gridRowCount(files.length, columns));
    const dragRow = $derived.by(() => {
        if (!dragKey) return -1;

        const index = files.findIndex((item) => fileKey(item) === dragKey);

        return index < 0 ? -1 : Math.floor(index / columns);
    });
    const view = createWindowRows<HTMLDivElement>({
        count: () => rowCount,
        estimateSize: () => 246,
        gap: GRID_GAP,
        overscan: 2,
        getItemKey: (index) => {
            const item = files[index * columns];

            return item ? `${columns}:${fileKey(item)}` : `row:${index}`;
        },
        extraIndexes: () => (dragRow >= 0 ? [dragRow] : [])
    });
    const focus = createFileFocus({
        rows: () => view.rows,
        count: () => files.length,
        key: (index) => {
            const item = files[index];

            return item ? fileKey(item) : undefined;
        },
        container: () => grid,
        row: (index) => Math.floor(index / columns),
        scrollToRow: (row) => view.scrollToRow(row)
    });

    function moveFocus(event: KeyboardEvent): void {
        const step = fileArrowStep(event, columns);
        if (step === null) return;

        const index = focusedFileIndex(event);
        if (index === null) return;

        const next = (focus.pending ?? index) + step;
        if (next < 0 || next >= files.length) return;

        event.preventDefault();
        focus.move(next);
    }

    function startDrag(item: FileGroup, event: DragEvent): void {
        focus.cancel();
        dragKey = fileKey(item);
        onstartdrag(item, event);
    }

    function endDrag(): void {
        dragKey = null;
        onenddrag();
    }

    view.trackMargin(() => grid);
    view.measureRendered(
        () => grid?.querySelectorAll<HTMLDivElement>('.file-grid-row[data-index]') ?? []
    );
</script>

<MarqueeSelect
    class="flex min-h-0 flex-1 flex-col"
    {selected}
    disabled={browseDisabled || !files.length}
    onpreview={(keys) => onmarquee?.(keys)}
>
    <section class="mt-6 flex min-h-0 flex-1 flex-col gap-6" aria-labelledby="files-heading">
        <FolderTiles
            {folders}
            {actionsDisabled}
            {browseDisabled}
            {dragging}
            onopen={onopenfolder}
            onmenu={onfoldermenu}
            ondropfiles={(folder) => onmovefiles(folder.path)}
        />

        {#if files.length}
            {#if layout === FileLayout.List}
                <FileList
                    {files}
                    bind:sort
                    {dragKey}
                    {actionsDisabled}
                    {browseDisabled}
                    {showFolder}
                    {showOwner}
                    {action}
                    {selected}
                    {onselect}
                    {onselectall}
                    {oncontextselect}
                    {onselectionmenu}
                    onstartdrag={startDrag}
                    onenddrag={endDrag}
                    partial={hasMore}
                    {ondownload}
                    {ondelete}
                    {onrestore}
                    {onopenpreview}
                    onmenu={onfilemenu}
                />
            {:else}
                <div
                    class="file-grid-window"
                    bind:this={grid}
                    bind:clientWidth={gridWidth}
                    style:height={`${view.totalSize}px`}
                    role="list"
                >
                    {#each view.rows as row (row.key)}
                        <div
                            class="file-grid-row"
                            data-index={row.index}
                            role="presentation"
                            style:transform={`translateY(${row.start - view.scrollMargin}px)`}
                        >
                            <ul
                                class="file-grid-cards"
                                style={`--file-grid-columns: ${columns}`}
                                role="presentation"
                            >
                                {#each files.slice(row.index * columns, row.index * columns + columns) as item, offset (fileKey(item))}
                                    <li
                                        class="min-w-0"
                                        role="listitem"
                                        aria-setsize={files.length}
                                        aria-posinset={row.index * columns + offset + 1}
                                    >
                                        <FileCard
                                            {item}
                                            virtualIndex={row.index * columns + offset}
                                            {actionsDisabled}
                                            {browseDisabled}
                                            {showOwner}
                                            partial={hasMore}
                                            working={fileActionKind(action, item)}
                                            selected={selected.has(fileKey(item))}
                                            {multipleSelected}
                                            {onselect}
                                            {oncontextselect}
                                            {onselectionmenu}
                                            onstartdrag={startDrag}
                                            onenddrag={endDrag}
                                            onnavigate={moveFocus}
                                            {ondownload}
                                            {ondelete}
                                            {onrestore}
                                            {onopenpreview}
                                            onmenu={onfilemenu}
                                        />
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/each}
                </div>
            {/if}
        {:else if !folders.length}
            <div
                class="grid min-h-90 flex-1 place-items-center px-6 py-12 text-center text-sm text-muted"
            >
                {#if loading}
                    <LoadingIndicator aria-label="Loading Google Photos files" />
                {:else if loadFailed}
                    <p>Use Refresh to load your files again</p>
                {:else if filtered && hasFiles}
                    <p>No files match your search or filters</p>
                {:else}
                    <EmptyFiles />
                {/if}
            </div>
        {/if}

        {#if hasMore}
            <div class="flex justify-center">
                <Button
                    variant="outlined"
                    {loading}
                    loadingAriaLabel="Loading more files"
                    disabled={actionsDisabled || browseDisabled}
                    onclick={onmore}
                >
                    Load more
                </Button>
            </div>
        {/if}
    </section>
</MarqueeSelect>

<style>
    .file-grid-window {
        position: relative;
        width: 100%;
        min-width: 0;
        overflow-anchor: none;
    }

    .file-grid-row {
        position: absolute;
        inset-inline: 0;
        top: 0;
    }

    .file-grid-cards {
        display: grid;
        grid-template-columns: repeat(var(--file-grid-columns), minmax(0, 1fr));
        gap: 16px;
        margin: 0;
        padding: 0;
        list-style: none;
    }
</style>
