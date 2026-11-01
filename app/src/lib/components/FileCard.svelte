<script lang="ts">
    import { Card, Checkbox } from 'noph-ui';
    import type { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import { fileKey, fileType } from '@madkarmaa/phodrive-core/files';
    import FileActions from '#components/FileActions.svelte';
    import MoreButton from '#components/MoreButton.svelte';
    import FileIncompleteWarning from '#components/FileIncompleteWarning.svelte';
    import IconDescriptionOutline from '~icons/material-symbols/description-outline';
    import type { MenuAnchor } from '#browser/drive/menu-types';

    interface Props {
        item: FileGroup;
        disabled: boolean;
        working?: FileActionKind | null;
        showOwner?: boolean;
        partial?: boolean;
        selected?: boolean;
        selectedCount?: number;
        onselect?: (
            item: FileGroup,
            event: MouseEvent | KeyboardEvent,
            mode?: 'toggle' | 'point'
        ) => void;
        oncontextselect?: (item: FileGroup) => void;
        onselectionmenu?: (anchor: MenuAnchor) => void;
        ondownload?: (item: FileGroup) => void;
        ondelete?: (item: FileGroup) => void;
        onrestore?: (item: FileGroup) => void;
        onopenpreview?: (item: FileGroup, trigger: HTMLElement) => void;
        onmenu: (item: FileGroup, anchor: MenuAnchor) => void;
        onstartdrag?: (item: FileGroup, event: DragEvent) => void;
        onenddrag?: (event: DragEvent) => void;
    }

    let {
        item,
        disabled,
        working = null,
        showOwner = false,
        partial = false,
        selected = false,
        selectedCount = 0,
        onselect,
        oncontextselect,
        onselectionmenu,
        ondownload,
        ondelete,
        onrestore,
        onopenpreview,
        onmenu,
        onstartdrag,
        onenddrag
    }: Props = $props();
    let isChecked = $state(false);
    let dragOrigin: EventTarget | null = null;

    $effect(() => {
        isChecked = selected;
    });

    function interactive(target: EventTarget | null): boolean {
        return (
            target instanceof Element &&
            target.closest(
                'button, a, input, label, select, textarea, [role="button"], [role="checkbox"], [role="menuitem"], [role="tooltip"]'
            ) !== null
        );
    }

    function cardClick(event: MouseEvent): void {
        if (event.detail > 1 || interactive(event.target)) return;

        onselect?.(item, event, 'point');
    }

    function cardKeydown(event: KeyboardEvent): void {
        if (event.key !== ' ' || event.target !== event.currentTarget) return;

        event.preventDefault();
        onselect?.(item, event, 'toggle');
    }

    function startDrag(event: DragEvent): void {
        if (event.altKey || interactive(event.target) || interactive(dragOrigin)) {
            event.preventDefault();

            return;
        }

        onstartdrag?.(item, event);
    }

    function endDrag(event: DragEvent): void {
        dragOrigin = null;
        onenddrag?.(event);
    }

    function contextMenu(event: MouseEvent): void {
        event.preventDefault();
        if (selectedCount > 1 && selected) {
            onselectionmenu?.({ x: event.clientX, y: event.clientY });

            return;
        }

        if (!selected) oncontextselect?.(item);
        onmenu(item, { x: event.clientX, y: event.clientY });
    }

    function cardDoubleClick(event: MouseEvent): void {
        if (disabled || interactive(event.target)) return;

        const shell = event.currentTarget;
        if (!(shell instanceof HTMLElement)) return;

        shell.focus();
        onopenpreview?.(item, shell);
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<div
    class="file-card-shell"
    class:selected
    role="group"
    aria-label={item.name}
    tabindex="0"
    draggable={!disabled}
    data-file-key={fileKey(item)}
    onclick={cardClick}
    ondblclick={cardDoubleClick}
    onkeydown={cardKeydown}
    oncontextmenu={contextMenu}
    onpointerdowncapture={(event) => (dragOrigin = event.target)}
    ondragstart={startDrag}
    ondragend={endDrag}
>
    <Card type="text" variant="filled" class="file-card">
        <div class="flex h-12 min-w-0 items-center gap-2 px-2">
            <Checkbox
                aria-label={`Select ${item.name}`}
                class="card-select"
                bind:checked={isChecked}
                {disabled}
                --np-checkbox-margin="7px"
                onclick={(event) => {
                    event.stopPropagation();
                    onselect?.(item, event, 'toggle');
                    if (event.shiftKey) {
                        const input = event.currentTarget;
                        queueMicrotask(() => {
                            input.checked = true;
                        });
                    }
                }}
            />
            <IconDescriptionOutline aria-hidden="true" class="size-5 shrink-0 text-muted" />
            <h3 class="min-w-0 flex-1 truncate text-sm font-medium" title={item.name}>
                {item.name}
            </h3>
        </div>
        {#if showOwner}
            <p class="m-0 truncate px-3 pb-1 text-xs text-muted" title={item.email}>{item.email}</p>
        {/if}

        <div
            class="file-preview mx-2 mb-2 grid place-items-center rounded bg-preview"
            aria-hidden="true"
        >
            <div class="relative size-22 text-muted">
                <IconDescriptionOutline class="size-22" />
                <span
                    class="absolute top-13 left-3 w-16 truncate rounded bg-preview text-center text-xs font-medium"
                    >{fileType(item.name)}</span
                >
            </div>
        </div>

        {#if !item.complete || item.trashedChunks.length > 0}
            <div class="px-3 pb-2">
                <FileIncompleteWarning {item} {partial} />
            </div>
        {/if}

        <div class="flex flex-wrap items-center justify-end gap-1 px-2 pb-2">
            <div class="card-inline-actions">
                <FileActions
                    {item}
                    {disabled}
                    {working}
                    {partial}
                    shortDelete
                    {ondownload}
                    {ondelete}
                    {onrestore}
                />
            </div>
            <MoreButton label={item.name} {disabled} onopen={(element) => onmenu(item, element)} />
        </div>
    </Card>
</div>

<style>
    .file-card-shell {
        min-width: 0;
        border-radius: 12px;
    }

    .file-card-shell :global(.np-checkbox-container.card-select) {
        opacity: 0;
        transition: opacity var(--np-motion-standard-fast-effects);
    }

    .file-card-shell:hover :global(.np-checkbox-container.card-select),
    .file-card-shell:focus-within :global(.np-checkbox-container.card-select),
    .file-card-shell.selected :global(.np-checkbox-container.card-select) {
        opacity: 1;
    }

    @media (hover: none), (pointer: coarse) {
        .file-card-shell :global(.np-checkbox-container.card-select) {
            opacity: 1;
        }
    }

    .file-card-shell:focus-visible {
        outline: 2px solid var(--app-primary);
        outline-offset: 2px;
    }

    .file-card-shell.selected :global(.file-card.np-card-container) {
        --np-filled-card-container-color: color-mix(
            in srgb,
            var(--app-primary) 12%,
            var(--app-card)
        );
        box-shadow: inset 0 0 0 2px var(--app-primary);
    }

    :global(:root .file-card.np-card-container) {
        width: 100%;
        container-type: inline-size;
        min-width: 0;
        overflow: hidden;
        --np-filled-card-container-color: var(--app-card);
        --np-filled-card-container-shape: 12px;
    }

    :global(:root .file-card.np-card-container .np-card-content) {
        margin: 0;
        gap: 0;
        min-width: 0;
        width: 100%;
    }
    .file-preview {
        height: calc(100cqi - 96px);
        min-height: 150px;
    }

    .card-inline-actions {
        display: flex;
        min-width: 0;
    }

    @container (width < 260px) {
        .card-inline-actions {
            display: none;
        }
    }
</style>
