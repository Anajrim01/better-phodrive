<script lang="ts">
    import type { FolderEntry } from '@madkarmaa/phodrive-core/files';
    import { folderCount } from '#lib/folders';
    import IconFolder from '~icons/material-symbols/folder-outline';

    interface Props {
        folders: FolderEntry[];
        disabled: boolean;
        onopen: (path: string) => void;
    }

    let { folders, disabled, onopen }: Props = $props();
</script>

{#if folders.length}
    <section class="folder-tiles" aria-labelledby="folder-tiles-heading">
        <h2 id="folder-tiles-heading" class="folder-tiles-heading">Folders</h2>

        <ul
            class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4 p-0"
        >
            {#each folders as folder (folder.path)}
                <li class="min-w-0">
                    <button
                        type="button"
                        class="folder-tile"
                        aria-label={`Open folder ${folder.name}`}
                        {disabled}
                        onclick={() => onopen(folder.path)}
                    >
                        <IconFolder aria-hidden="true" class="size-5 shrink-0 text-muted" />
                        <span class="folder-text">
                            <span class="folder-name" title={folder.name}>{folder.name}</span>
                            <span class="folder-count">
                                {folderCount(folder.files, folder.subfolders)}
                            </span>
                        </span>
                    </button>
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
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-width: 0;
        min-height: 64px;
        padding: 12px 16px;
        border: none;
        border-radius: 12px;
        background: var(--app-card);
        color: var(--app-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
        transition:
            background-color var(--np-motion-standard-fast-effects),
            transform var(--np-motion-standard-fast-effects);
    }

    .folder-tile:active:not(:disabled) {
        transform: scale(0.98);
    }

    .folder-tile:hover:not(:disabled) {
        background: var(--app-hover);
    }

    .folder-tile:focus-visible {
        outline: 3px solid var(--app-primary);
        outline-offset: 2px;
    }

    .folder-tile:disabled {
        opacity: 0.6;
        cursor: default;
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
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .folder-count {
        color: var(--app-muted);
        font-size: 12px;
    }
</style>
