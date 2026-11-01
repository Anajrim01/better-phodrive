<script lang="ts">
    import { Checkbox } from 'noph-ui';
    import prettyBytes from 'pretty-bytes';
    import { fileKey, type FileGroup } from '@madkarmaa/phodrive-core/files';
    import type { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import LocalizedDate from '#components/LocalizedDate.svelte';
    import FileActions from '#components/FileActions.svelte';
    import MoreButton from '#components/MoreButton.svelte';
    import FileIncompleteWarning from '#components/FileIncompleteWarning.svelte';
    import IconDescription from '~icons/material-symbols/description-outline';
    import type { MenuAnchor } from '#browser/drive/menu-types';

    interface Props {
        item: FileGroup;
        selected: boolean;
        selectedCount: number;
        disabled: boolean;
        showFolder: boolean;
        showOwner: boolean;
        trash: boolean;
        partial: boolean;
        working: FileActionKind | null;
        onselect?: (item: FileGroup, event: MouseEvent | KeyboardEvent) => void;
        oncontextselect?: (item: FileGroup) => void;
        onselectionmenu?: (anchor: MenuAnchor) => void;
        ondownload?: (item: FileGroup) => void;
        ondelete?: (item: FileGroup) => void;
        onrestore?: (item: FileGroup) => void;
        ondeleteforever?: (item: FileGroup) => void;
        onmenu?: (item: FileGroup, anchor: MenuAnchor) => void;
    }

    let {
        item,
        selected,
        selectedCount,
        disabled,
        showFolder,
        showOwner,
        trash,
        partial,
        working,
        onselect,
        oncontextselect,
        onselectionmenu,
        ondownload,
        ondelete,
        onrestore,
        ondeleteforever,
        onmenu
    }: Props = $props();
    let isChecked = $state(false);

    $effect(() => {
        isChecked = selected;
    });

    function interactive(target: EventTarget | null): boolean {
        return (
            target instanceof Element &&
            target.closest('button, a, input, select, textarea') !== null
        );
    }

    function contextMenu(event: MouseEvent): void {
        event.preventDefault();
        const key = fileKey(item);
        if (selectedCount > 1 && selected) {
            onselectionmenu?.({ x: event.clientX, y: event.clientY });

            return;
        }

        if (!selected) oncontextselect?.(item);
        onmenu?.(item, { x: event.clientX, y: event.clientY });
    }

    function rowClick(event: MouseEvent): void {
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return;
        if (interactive(event.target)) return;

        onselect?.(item, event);
    }

    function rowKeydown(event: KeyboardEvent): void {
        if (event.key !== ' ' || event.target !== event.currentTarget) return;

        event.preventDefault();
        onselect?.(item, event);
    }
</script>

<tr
    class:selected
    tabindex="0"
    onclick={rowClick}
    onkeydown={rowKeydown}
    oncontextmenu={contextMenu}
>
    <td class="select-column">
        <div class="select-cell">
            <Checkbox
                aria-label={`Select ${item.name}`}
                bind:checked={isChecked}
                {disabled}
                onclick={(event) => {
                    event.stopPropagation();
                    onselect?.(item, event);
                    if (event.shiftKey) {
                        const input = event.currentTarget;
                        queueMicrotask(() => {
                            input.checked = true;
                        });
                    }
                }}
            />
        </div>
    </td>
    <td>
        <div class="file-name">
            <IconDescription aria-hidden="true" class="size-5 shrink-0 text-muted" />
            <div class="min-w-0">
                <span class="block truncate font-medium" title={item.name}>{item.name}</span>
                {#if showFolder && item.folder}
                    <span class="block truncate text-xs text-muted" title={item.folder}
                        >{item.folder}</span
                    >
                {/if}
                {#if showOwner}
                    <span class="block truncate text-xs text-muted" title={item.email}
                        >{item.email}</span
                    >
                {/if}
                {#if !item.complete || (!trash && item.trashedChunks.length > 0)}
                    <FileIncompleteWarning {item} {partial} {trash} />
                {:else}
                    <span class="mobile-date text-xs text-muted"
                        ><LocalizedDate timestamp={item.at} /></span
                    >
                {/if}
            </div>
        </div>
    </td>
    <td class="date-column"><LocalizedDate timestamp={item.at} /></td>
    <td class="size-column">
        {#if item.complete}
            {prettyBytes(item.chunks.reduce((sum, chunk) => sum + chunk.size, 0))}
        {:else}<span title="Size is unknown while not all chunks are available">Unknown</span>{/if}
    </td>
    <td class="actions-column">
        <div class="actions-cell">
            <div class="inline-actions">
                <FileActions
                    {item}
                    {disabled}
                    compact
                    {trash}
                    {partial}
                    {working}
                    {ondownload}
                    {ondelete}
                    {onrestore}
                    {ondeleteforever}
                />
            </div>
            <MoreButton
                label={item.name}
                {disabled}
                onopen={(element) => onmenu?.(item, element)}
            />
        </div>
    </td>
</tr>

<style>
    td {
        height: 48px;
        border-bottom: 1px solid var(--app-border);
        padding: 4px 12px;
        text-align: start;
        vertical-align: middle;
    }

    tr {
        transition: background-color var(--np-motion-standard-fast-effects);
    }

    tr:hover,
    tr:focus-within {
        background: var(--np-color-surface-container);
    }

    tr.selected {
        background: color-mix(in srgb, var(--app-primary) 12%, transparent);
    }

    tr.selected:hover,
    tr.selected:focus-within {
        background: color-mix(in srgb, var(--app-primary) 18%, transparent);
    }

    tr:focus-visible {
        outline: 2px solid var(--app-primary);
        outline-offset: -2px;
    }

    .mobile-date {
        display: none;
        font-variant-numeric: tabular-nums;
    }

    td:not(:first-child) {
        color: var(--app-muted);
        font-variant-numeric: tabular-nums;
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

    .file-name {
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 0;
    }

    .date-column {
        width: 180px;
    }
    .size-column {
        width: 100px;
        font-variant-numeric: tabular-nums;
        text-align: end;
        white-space: nowrap;
    }
    .actions-column {
        width: 144px;
        padding-inline: 4px;
    }

    .actions-cell {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 2px;
    }

    .inline-actions {
        display: flex;
        align-items: center;
    }

    @media (width < 800px) {
        td {
            height: 56px;
            padding-inline: 4px;
        }
        .date-column {
            display: none;
        }
        .mobile-date {
            display: block;
        }
        .size-column {
            width: 76px;
        }
        .file-name {
            gap: 8px;
        }
        .actions-column {
            width: 56px;
        }
        .inline-actions {
            display: none;
        }
    }

    @media (width < 520px) {
        .size-column {
            display: none;
        }
        .select-column {
            width: 48px;
            padding-inline: 0;
        }
    }
</style>
