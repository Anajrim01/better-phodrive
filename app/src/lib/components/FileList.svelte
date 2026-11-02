<script lang="ts">
    import { Button, Checkbox } from 'noph-ui';
    import { FileSort } from '@madkarmaa/phodrive-core/models';
    import { fileKey, type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
    import FileListBody from '#components/FileListBody.svelte';
    import IconArrowUp from '~icons/material-symbols/arrow-upward';
    import IconArrowDown from '~icons/material-symbols/arrow-downward';
    import type { MenuAnchor } from '#browser/drive/menu-types';

    interface Props {
        files: FileGroup[];
        sort: FileSort;
        actionsDisabled: boolean;
        browseDisabled?: boolean;
        showFolder?: boolean;
        showOwner?: boolean;
        trash?: boolean;
        partial?: boolean;
        dragKey?: string | null;
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
        onopenpreview?: (item: FileGroup, trigger: HTMLElement) => void;
        onmenu?: (item: FileGroup, anchor: MenuAnchor) => void;
    }

    let {
        files,
        sort = $bindable(),
        actionsDisabled,
        browseDisabled = false,
        showFolder = false,
        showOwner = false,
        trash = false,
        partial = false,
        dragKey = null,
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
        onopenpreview,
        onmenu
    }: Props = $props();
    const nameSort = $derived(sort === FileSort.NameAscending || sort === FileSort.NameDescending);
    const ascending = $derived(
        sort === FileSort.NameAscending || sort === FileSort.ModifiedAscending
    );
    const selectedCount = $derived(
        files.reduce((count, item) => count + (selected.has(fileKey(item)) ? 1 : 0), 0)
    );
    const multipleSelected = $derived(selectedCount > 1);
    const allSelected = $derived(files.length > 0 && selectedCount === files.length);
    const someSelected = $derived(selectedCount > 0 && !allSelected);
</script>

<div class="file-list-wrap">
    <table
        class="file-list"
        class:trash
        aria-labelledby={headingId}
        aria-rowcount={files.length + 1}
    >
        <thead>
            <tr aria-rowindex="1">
                <th scope="col" class="select-column">
                    <div class="select-cell">
                        <Checkbox
                            aria-label="Select all visible files"
                            checked={allSelected}
                            indeterminate={someSelected}
                            disabled={browseDisabled || files.length === 0}
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
        <FileListBody
            {files}
            {actionsDisabled}
            {browseDisabled}
            {showFolder}
            {showOwner}
            {trash}
            {partial}
            {dragKey}
            {action}
            {selected}
            {multipleSelected}
            {onselect}
            {oncontextselect}
            {onselectionmenu}
            {onstartdrag}
            {onenddrag}
            {ondownload}
            {ondelete}
            {onrestore}
            {ondeleteforever}
            {onopenpreview}
            {onmenu}
        />
    </table>
</div>

<style>
    .file-list-wrap {
        width: 100%;
        min-width: 0;
        container-type: inline-size;
        overflow-anchor: none;
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
    .file-list.trash .actions-column {
        width: 248px;
    }

    .file-list :global(.column-sort) {
        --np-button-padding: 12px;
        --np-button-gap: 4px;
        --np-text-button-label-text-color: var(--np-color-on-surface);
        margin-inline: -12px;
        font-size: 14px;
    }

    @container (width < 900px) {
        .file-list.trash .actions-column {
            width: 56px;
        }
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
