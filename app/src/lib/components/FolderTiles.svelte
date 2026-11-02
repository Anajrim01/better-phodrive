<script lang="ts">
    import type { FolderEntry } from '@madkarmaa/phodrive-core/files';
    import { folderCount } from '#lib/folders';
    import { FILE_DRAG_TYPE } from '#browser/drive/drag-types';
    import MoreButton from '#components/MoreButton.svelte';
    import type { MenuAnchor } from '#browser/drive/menu-types';
    import IconFolder from '~icons/material-symbols/folder-outline';

    interface Props {
        folders: FolderEntry[];
        disabled: boolean;
        dragging: boolean;
        onopen: (path: string) => void;
        onmenu: (folder: FolderEntry, anchor: MenuAnchor) => void;
        ondropfiles: (folder: FolderEntry) => void;
    }

    let { folders, disabled, dragging, onopen, onmenu, ondropfiles }: Props = $props();
    let dropPath = $state<string | null>(null);

    function accepts(event: DragEvent): boolean {
        return (
            !disabled && (dragging || event.dataTransfer?.types.includes(FILE_DRAG_TYPE) === true)
        );
    }

    function over(folder: FolderEntry, event: DragEvent): void {
        if (!accepts(event)) return;

        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        dropPath = folder.path;
    }

    function leave(folder: FolderEntry, event: DragEvent): void {
        if (
            event.currentTarget instanceof Node &&
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
        )
            return;
        if (dropPath === folder.path) dropPath = null;
    }

    function drop(folder: FolderEntry, event: DragEvent): void {
        if (!accepts(event)) return;

        event.preventDefault();
        dropPath = null;
        ondropfiles(folder);
    }
</script>

{#if folders.length}
    <section class="folder-tiles" aria-labelledby="folder-tiles-heading">
        <h2 id="folder-tiles-heading" class="folder-tiles-heading">Folders</h2>

        <ul
            class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4 p-0 max-[800px]:grid-cols-2 max-[800px]:gap-3"
        >
            {#each folders as folder (folder.path)}
                <li
                    class="folder-tile"
                    class:drop-target={dropPath === folder.path}
                    oncontextmenu={(event) => {
                        event.preventDefault();
                        onmenu(folder, { x: event.clientX, y: event.clientY });
                    }}
                    ondragover={(event) => over(folder, event)}
                    ondragleave={(event) => leave(folder, event)}
                    ondrop={(event) => drop(folder, event)}
                >
                    <button
                        type="button"
                        class="folder-open"
                        aria-label={`Open folder ${folder.name}`}
                        {disabled}
                        onclick={() => onopen(folder.path)}
                        onkeydown={(event) => {
                            if (
                                event.key !== 'ContextMenu' &&
                                !(event.shiftKey && event.key === 'F10')
                            )
                                return;

                            event.preventDefault();
                            onmenu(folder, event.currentTarget);
                        }}
                    >
                        <IconFolder aria-hidden="true" class="size-5 shrink-0 text-muted" />
                        <span class="folder-text">
                            <span class="folder-name" title={folder.name}>{folder.name}</span>
                            <span class="folder-count">
                                {folderCount(folder.files, folder.subfolders)}
                            </span>
                        </span>
                    </button>
                    <span class="folder-more">
                        <MoreButton
                            label={folder.name}
                            {disabled}
                            onopen={(element) => onmenu(folder, element)}
                        />
                    </span>
                </li>
            {/each}
        </ul>
    </section>
{/if}

<style>
    .folder-tiles-heading {
        margin: 0 0 8px;
        color: var(--app-muted);
        font-size: 12px;
        font-weight: 500;
    }

    .folder-tile {
        position: relative;
        display: flex;
        align-items: stretch;
        min-width: 0;
        min-height: 64px;
        border-radius: 12px;
        background: var(--app-card);
        color: var(--app-text);
        transition:
            background-color var(--np-motion-standard-fast-effects),
            transform var(--np-motion-standard-fast-effects);
    }

    @media (prefers-reduced-motion: no-preference) {
        .folder-tile:active {
            transform: scale(0.98);
        }
    }

    .folder-tile:hover {
        background: var(--app-hover);
    }

    .folder-tile.drop-target {
        background: color-mix(in srgb, var(--app-primary) 12%, var(--app-card));
        box-shadow: inset 0 0 0 2px var(--app-primary);
    }

    .folder-open {
        display: flex;
        flex: 1;
        align-items: center;
        gap: 12px;
        min-width: 0;
        min-height: 64px;
        padding: 12px 44px 12px 16px;
        border: none;
        border-radius: 12px;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .folder-open:focus-visible {
        outline: 3px solid var(--app-primary);
        outline-offset: -3px;
    }

    .folder-open:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .folder-more {
        position: absolute;
        top: 50%;
        right: 8px;
        display: flex;
        transform: translateY(-50%);
    }

    .folder-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }

    .folder-name {
        overflow: hidden;
        font-size: 14px;
        font-weight: 500;
        line-height: 20px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .folder-count {
        color: var(--app-muted);
        font-size: 12px;
        line-height: 16px;
    }
</style>
