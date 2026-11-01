<script lang="ts">
    import { Button, LoadingIndicator } from 'noph-ui';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import { FileSort } from '@madkarmaa/phodrive-core/models';
    import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
    import { sortFiles, type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
    import FileList from '#components/FileList.svelte';
    import MarqueeSelect from '#components/MarqueeSelect.svelte';
    import GroupListingStatus from '#components/GroupListingStatus.svelte';
    import type { MenuAnchor } from '#browser/drive/menu-types';

    interface Props {
        files: FileGroup[];
        sort: FileSort;
        disabled: boolean;
        loading: boolean;
        loadFailed: boolean;
        hasMore: boolean;
        showOwner?: boolean;
        groupName?: string;
        total?: number;
        accounts?: readonly GroupAccountState[];
        partial?: boolean;
        action?: FileAction | null;
        selected?: ReadonlySet<string>;
        onselect?: (item: FileGroup, event: MouseEvent | KeyboardEvent) => void;
        onselectall?: (select: boolean) => void;
        oncontextselect?: (item: FileGroup) => void;
        onselectionmenu?: (anchor: MenuAnchor) => void;
        onmarquee?: (keys: ReadonlySet<string>) => void;
        onrestore: (item: FileGroup) => void;
        ondeleteforever: (item: FileGroup) => void;
        onmenu: (item: FileGroup, anchor: MenuAnchor) => void;
        onmore: () => void;
    }

    let {
        files,
        sort = $bindable(),
        disabled,
        loading,
        loadFailed,
        hasMore,
        showOwner = false,
        groupName,
        total = 0,
        accounts = [],
        partial = false,
        action = null,
        selected = new Set<string>(),
        onselect,
        onselectall,
        oncontextselect,
        onselectionmenu,
        onmarquee,
        onrestore,
        ondeleteforever,
        onmenu,
        onmore
    }: Props = $props();

    const sorted = $derived(sortFiles(files, sort));
    const more = $derived(hasMore || partial);
</script>

<div class="flex flex-1 flex-col" in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
    <div class="workspace-heading">
        <h1 id="trash-heading" class="min-w-0">
            Trash <span class="text-subtle tabular-nums">({files.length})</span>
        </h1>
    </div>
    <p class="m-0 mb-6 max-w-2xl text-sm text-muted">
        Files here are in Google Photos trash. Restore them or delete them forever.
    </p>

    {#if groupName}
        <GroupListingStatus {groupName} {total} {accounts} />
    {/if}

    <MarqueeSelect
        class="flex min-h-0 flex-1 flex-col"
        {selected}
        disabled={disabled || !files.length}
        onpreview={(keys) => onmarquee?.(keys)}
    >
        {#if files.length}
            <FileList
                files={sorted}
                bind:sort
                {disabled}
                {action}
                {selected}
                {onselect}
                {onselectall}
                {oncontextselect}
                {onselectionmenu}
                showFolder
                {showOwner}
                trash
                partial={more}
                headingId="trash-heading"
                {onrestore}
                {ondeleteforever}
                {onmenu}
            />
        {:else}
            <div
                class="grid min-h-90 flex-1 place-items-center px-6 py-12 text-center text-sm text-muted"
            >
                {#if loading}
                    <LoadingIndicator aria-label="Loading trash" />
                {:else if loadFailed}
                    <p>Use Refresh to load your files again</p>
                {:else if more}
                    <p role="status">No trashed files in the loaded pages.</p>
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
    </MarqueeSelect>
</div>
