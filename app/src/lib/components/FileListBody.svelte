<script lang="ts">
    import {
        fileActionKind,
        fileKey,
        type FileAction,
        type FileGroup
    } from '@madkarmaa/phodrive-core/files';
    import FileListRow from '#components/FileListRow.svelte';
    import { focusedFileIndex } from '#lib/file-item-keys';
    import { createFileFocus } from '#lib/file-focus.svelte';
    import { createWindowRows } from '#lib/virtual-window.svelte';
    import { listGaps, listSpacers } from '#lib/file-window';
    import type { MenuAnchor } from '#browser/drive/menu-types';

    interface Props {
        files: FileGroup[];
        actionsDisabled: boolean;
        browseDisabled?: boolean;
        showFolder?: boolean;
        showOwner?: boolean;
        trash?: boolean;
        partial?: boolean;
        dragKey?: string | null;
        action?: FileAction | null;
        selected?: ReadonlySet<string>;
        multipleSelected: boolean;
        onselect?: (
            item: FileGroup,
            event: MouseEvent | KeyboardEvent,
            mode?: 'toggle' | 'point'
        ) => void;
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
        actionsDisabled,
        browseDisabled = false,
        showFolder = false,
        showOwner = false,
        trash = false,
        partial = false,
        dragKey = null,
        action = null,
        selected = new Set<string>(),
        multipleSelected,
        onselect,
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
    let tbody = $state<HTMLTableSectionElement>();
    const dragIndex = $derived(dragKey ? files.findIndex((item) => fileKey(item) === dragKey) : -1);
    const view = createWindowRows<HTMLTableRowElement>({
        count: () => files.length,
        estimateSize: () => 48,
        getItemKey: (index) => {
            const item = files[index];

            return item ? fileKey(item) : `row:${index}`;
        },
        extraIndexes: () => (dragIndex >= 0 ? [dragIndex] : [])
    });
    const focus = createFileFocus({
        rows: () => view.rows,
        count: () => files.length,
        key: (index) => {
            const item = files[index];

            return item ? fileKey(item) : undefined;
        },
        container: () => tbody,
        row: (index) => index,
        scrollToRow: (row) => view.scrollToRow(row)
    });
    const spacers = $derived(listSpacers(view.rows, view.totalSize, view.scrollMargin));
    const gaps = $derived(listGaps(view.rows));

    function startDrag(item: FileGroup, event: DragEvent): void {
        focus.cancel();
        onstartdrag?.(item, event);
    }

    function moveFocus(event: KeyboardEvent): void {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

        const index = focusedFileIndex(event);
        if (index === null) return;

        const next = (focus.pending ?? index) + (event.key === 'ArrowDown' ? 1 : -1);
        if (next < 0 || next >= files.length) return;

        event.preventDefault();
        focus.move(next);
    }

    view.trackMargin(() => tbody);
    view.measureRendered(
        () => tbody?.querySelectorAll<HTMLTableRowElement>('tr[data-index]') ?? []
    );
</script>

<tbody bind:this={tbody}>
    {#if spacers.top > 0}
        <tr class="spacer" aria-hidden="true">
            <td colspan="5" style:height={`${spacers.top}px`}></td>
        </tr>
    {/if}
    {#each view.rows as row, position (row.key)}
        {@const gap = gaps[position] ?? 0}
        {#if gap > 0}
            <tr class="spacer" aria-hidden="true">
                <td colspan="5" style:height={`${gap}px`}></td>
            </tr>
        {/if}
        {@const item = files[row.index]}
        {#if item}
            <FileListRow
                {item}
                virtualIndex={row.index}
                selected={selected.has(fileKey(item))}
                {multipleSelected}
                {actionsDisabled}
                {browseDisabled}
                {showFolder}
                {showOwner}
                {trash}
                {partial}
                working={fileActionKind(action, item)}
                {onselect}
                {oncontextselect}
                {onselectionmenu}
                onstartdrag={startDrag}
                {onenddrag}
                onnavigate={moveFocus}
                {ondownload}
                {ondelete}
                {onrestore}
                {ondeleteforever}
                {onopenpreview}
                {onmenu}
            />
        {/if}
    {/each}
    {#if spacers.bottom > 0}
        <tr class="spacer" aria-hidden="true">
            <td colspan="5" style:height={`${spacers.bottom}px`}></td>
        </tr>
    {/if}
</tbody>

<style>
    .spacer td {
        height: 0;
        padding: 0;
        border: 0;
    }
</style>
