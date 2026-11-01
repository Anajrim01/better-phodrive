<script lang="ts">
    import { Button, Checkbox } from 'noph-ui';
    import { FileSort } from '@madkarmaa/phodrive-core/models';
    import {
        fileActionKind,
        fileKey,
        type FileAction,
        type FileGroup
    } from '@madkarmaa/phodrive-core/files';
    import FileListRow from '#components/FileListRow.svelte';
    import IconArrowUp from '~icons/material-symbols/arrow-upward';
    import IconArrowDown from '~icons/material-symbols/arrow-downward';
    import type { MenuAnchor } from '#browser/drive/menu-types';

    interface Props {
        files: FileGroup[];
        sort: FileSort;
        disabled: boolean;
        showFolder?: boolean;
        showOwner?: boolean;
        trash?: boolean;
        partial?: boolean;
        headingId?: string;
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
        onstartdrag?: (item: FileGroup, event: DragEvent) => void;
        onenddrag?: () => void;
        ondownload?: (item: FileGroup) => void;
        ondelete?: (item: FileGroup) => void;
        onrestore?: (item: FileGroup) => void;
        ondeleteforever?: (item: FileGroup) => void;
        onmenu?: (item: FileGroup, anchor: MenuAnchor) => void;
    }

    let {
        files,
        sort = $bindable(),
        disabled,
        showFolder = false,
        showOwner = false,
        trash = false,
        partial = false,
        headingId = 'files-heading',
        action = null,
        selected = new Set<string>(),
        onselect,
        onselectall,
        oncontextselect,
        onselectionmenu,
        onstartdrag,
        onenddrag,
        ondownload,
        ondelete,
        onrestore,
        ondeleteforever,
        onmenu
    }: Props = $props();
    const nameSort = $derived(sort === FileSort.NameAscending || sort === FileSort.NameDescending);
    const ascending = $derived(
        sort === FileSort.NameAscending || sort === FileSort.ModifiedAscending
    );
    const selectedCount = $derived(files.filter((item) => selected.has(fileKey(item))).length);
    const selectedKeys = $derived(new Set([...selected]));
    const allSelected = $derived(files.length > 0 && selectedCount === files.length);
    const someSelected = $derived(selectedCount > 0 && !allSelected);
    let headerChecked = $state(false);
    let headerMixed = $state(false);

    $effect(() => {
        headerChecked = allSelected;
        headerMixed = someSelected;
    });
</script>

<div class="file-list-wrap">
    <table class="file-list" aria-labelledby={headingId}>
        <thead>
            <tr>
                <th scope="col" class="select-column">
                    <div class="select-cell">
                        <Checkbox
                            aria-label="Select all files"
                            bind:checked={headerChecked}
                            bind:indeterminate={headerMixed}
                            disabled={disabled || files.length === 0}
                            onclick={() => {
                                onselectall?.(!allSelected);
                            }}
                        />
                    </div>
                </th>
                <th
                    scope="col"
                    aria-sort={nameSort ? (ascending ? 'ascending' : 'descending') : 'none'}
                >
                    <Button
                        class="column-sort"
                        size="xs"
                        variant="text"
                        onclick={() =>
                            (sort =
                                sort === FileSort.NameAscending
                                    ? FileSort.NameDescending
                                    : FileSort.NameAscending)}
                    >
                        Name
                        {#snippet end()}
                            {#if nameSort}
                                {#if ascending}<IconArrowUp
                                        aria-hidden="true"
                                    />{:else}<IconArrowDown aria-hidden="true" />{/if}
                            {/if}
                        {/snippet}
                    </Button>
                </th>
                <th
                    scope="col"
                    class="date-column"
                    aria-sort={!nameSort ? (ascending ? 'ascending' : 'descending') : 'none'}
                >
                    <Button
                        class="column-sort"
                        size="xs"
                        variant="text"
                        onclick={() =>
                            (sort =
                                sort === FileSort.ModifiedDescending
                                    ? FileSort.ModifiedAscending
                                    : FileSort.ModifiedDescending)}
                    >
                        Date modified
                        {#snippet end()}
                            {#if !nameSort}
                                {#if ascending}<IconArrowUp
                                        aria-hidden="true"
                                    />{:else}<IconArrowDown aria-hidden="true" />{/if}
                            {/if}
                        {/snippet}
                    </Button>
                </th>
                <th scope="col" class="size-column">File size</th>
                <th scope="col" class="actions-column"><span class="sr-only">Actions</span></th>
            </tr>
        </thead>
        <tbody>
            {#each files as item (fileKey(item))}
                <FileListRow
                    {item}
                    selected={selectedKeys.has(fileKey(item))}
                    {selectedCount}
                    {disabled}
                    {showFolder}
                    {showOwner}
                    {trash}
                    {partial}
                    working={fileActionKind(action, item)}
                    {onselect}
                    {oncontextselect}
                    {onselectionmenu}
                    {onstartdrag}
                    {onenddrag}
                    {ondownload}
                    {ondelete}
                    {onrestore}
                    {ondeleteforever}
                    {onmenu}
                />
            {/each}
        </tbody>
    </table>
</div>

<style>
    .file-list-wrap {
        width: 100%;
        min-width: 0;
        container-type: inline-size;
    }

    .file-list {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        font-size: 14px;
    }

    th {
        height: 40px;
        border-bottom: 1px solid var(--app-border);
        padding: 4px 12px;
        font-weight: 500;
        text-align: start;
        vertical-align: middle;
        white-space: nowrap;
    }

    .select-column {
        width: 52px;
        padding-inline: 2px;
    }

    .select-cell {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .date-column {
        width: 170px;
    }
    .size-column {
        width: 92px;
        text-align: end;
        white-space: nowrap;
    }
    .actions-column {
        width: 144px;
        padding-inline: 4px;
    }

    .file-list :global(.column-sort) {
        --np-button-padding: 12px;
        --np-button-gap: 4px;
        --np-text-button-label-text-color: var(--np-color-on-surface);
        margin-inline: -12px;
        font-size: 14px;
    }

    @container (width < 820px) {
        th {
            padding-inline: 8px;
        }
        .date-column {
            display: none;
        }
    }

    @container (width < 560px) {
        th {
            padding-inline: 4px;
        }
        .size-column {
            display: none;
        }
        .actions-column {
            width: 56px;
        }
        .select-column {
            width: 48px;
            padding-inline: 0;
        }
    }
</style>
