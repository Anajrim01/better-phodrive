<script lang="ts">
    import { Button, LoadingIndicator } from 'noph-ui';
    import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
    import { fade } from 'svelte/transition';
    import { flip } from 'svelte/animate';
    import { prefersReducedMotion } from 'svelte/motion';
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
        disabled: boolean;
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
        disabled,
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
    const selectedCount = $derived(files.filter((item) => selected.has(fileKey(item))).length);
    const selectedKeys = $derived(new Set([...selected]));
</script>

<MarqueeSelect
    class="flex min-h-0 flex-1 flex-col"
    {selected}
    disabled={disabled || !files.length}
    onpreview={(keys) => onmarquee?.(keys)}
>
    <section class="mt-6 flex min-h-0 flex-1 flex-col gap-6" aria-labelledby="files-heading">
        <FolderTiles
            {folders}
            {disabled}
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
                    {disabled}
                    {showFolder}
                    {showOwner}
                    {action}
                    {selected}
                    {onselect}
                    {onselectall}
                    {oncontextselect}
                    {onselectionmenu}
                    {onstartdrag}
                    {onenddrag}
                    partial={hasMore}
                    {ondownload}
                    {ondelete}
                    {onrestore}
                    {onopenpreview}
                    onmenu={onfilemenu}
                />
            {:else}
                <ul
                    class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4 p-0"
                >
                    {#each files as item (fileKey(item))}
                        <li
                            class="min-w-0"
                            animate:flip={{ duration: prefersReducedMotion.current ? 0 : 180 }}
                            transition:fade={{ duration: prefersReducedMotion.current ? 0 : 150 }}
                        >
                            <FileCard
                                {item}
                                {disabled}
                                {showOwner}
                                partial={hasMore}
                                working={fileActionKind(action, item)}
                                selected={selectedKeys.has(fileKey(item))}
                                {selectedCount}
                                {onselect}
                                {oncontextselect}
                                {onselectionmenu}
                                {onstartdrag}
                                {onenddrag}
                                {ondownload}
                                {ondelete}
                                {onrestore}
                                {onopenpreview}
                                onmenu={onfilemenu}
                            />
                        </li>
                    {/each}
                </ul>
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
                    {disabled}
                    onclick={onmore}
                >
                    Load more
                </Button>
            </div>
        {/if}
    </section>
</MarqueeSelect>
