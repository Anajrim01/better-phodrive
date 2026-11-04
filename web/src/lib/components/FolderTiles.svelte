<script lang="ts">
    import type { FolderEntry } from '@madkarmaa/phodrive-core/files';
    import { folderCount } from '#lib/folders';
    import IconFolder from '~icons/material-symbols/folder-outline';

    interface Props {
        folders: FolderEntry[];
        disabled?: boolean;
        onopen: (path: string) => void;
    }

    let { folders, disabled = false, onopen }: Props = $props();
</script>

{#if folders.length}
    <section aria-labelledby="folder-tiles-heading">
        <h2 id="folder-tiles-heading" class="sr-only">Folders</h2>
        <ul
            class="mt-4 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4 p-0"
        >
            {#each folders as folder (folder.path)}
                <li class="min-w-0">
                    <button
                        type="button"
                        class="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                        aria-label={`Open folder ${folder.name}`}
                        {disabled}
                        onclick={() => onopen(folder.path)}
                    >
                        <IconFolder aria-hidden="true" class="size-6 shrink-0 text-primary" />
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium" title={folder.name}
                                >{folder.name}</span
                            >
                            <span class="block truncate text-xs text-muted"
                                >{folderCount(folder.files, folder.subfolders)}</span
                            >
                        </span>
                    </button>
                </li>
            {/each}
        </ul>
    </section>
{/if}
