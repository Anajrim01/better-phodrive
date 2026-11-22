<script lang="ts">
    import { Button } from 'noph-ui';
    import { onMount, tick } from 'svelte';
    import { folderTrail } from '@madkarmaa/phodrive-core/files';
    import type { DriveFileLocations } from '#browser/drive/file-locations.svelte';
    import IconFolder from '~icons/material-symbols/folder-outline';

    let {
        locations,
        hasMore,
        loading,
        onmore,
        onclose
    }: {
        locations: DriveFileLocations;
        hasMore: boolean;
        loading: boolean;
        onmore: () => void;
        onclose: () => void;
    } = $props();
    const trail = $derived(folderTrail(locations.destination));
    const count = $derived(locations.selected.length);
    const changesFolder = $derived(
        locations.selected.some((item) => item.folder !== locations.destination)
    );
    const id = $props.id();
    let heading = $state<HTMLHeadingElement>();

    onMount(() => heading?.focus());

    async function openFolder(path: string) {
        locations.destination = path;
        await tick();
        heading?.focus();
    }

    async function move() {
        await locations.move();
        if (!locations.moving) onclose();
    }
</script>

<section class="move-panel min-w-0 border border-border p-4 text-text" aria-labelledby={id}>
    <h2 class="m-0 text-base font-medium" {id} bind:this={heading} tabindex="-1">
        Move {count}
        {count === 1 ? 'file' : 'files'}
    </h2>
    <p class="mt-2 mb-1 text-sm">{locations.owner?.email}</p>
    <nav aria-label="Destination folder" class="flex flex-wrap items-center gap-1">
        <Button variant="text" size="xs" disabled={locations.saving} onclick={() => openFolder('')}
            >Files</Button
        >
        {#each trail as crumb (crumb.path)}
            <span aria-hidden="true">/</span>
            <Button
                variant="text"
                size="xs"
                disabled={locations.saving}
                onclick={() => openFolder(crumb.path)}>{crumb.name}</Button
            >
        {/each}
    </nav>
    <ul class="m-0 list-none border-t border-border p-0">
        {#each locations.folders as folder (folder.path)}
            <li class="border-b border-border">
                <button
                    type="button"
                    class="flex min-h-10 w-full items-center gap-2 px-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary"
                    disabled={locations.saving}
                    onclick={() => openFolder(folder.path)}
                >
                    <IconFolder class="size-4 shrink-0" aria-hidden="true" />
                    <span class="min-w-0 break-words">{folder.name}</span>
                </button>
            </li>
        {/each}
    </ul>
    {#if hasMore}
        <Button variant="text" size="xs" disabled={locations.disabled || !count} onclick={onmore}>
            {loading ? 'Loading folders…' : 'Load more folders'}
        </Button>
    {/if}
    {#if locations.error}
        <p role="alert" class="my-2 text-sm text-error">{locations.error}</p>
    {/if}
    <div class="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="text" size="xs" disabled={locations.saving} onclick={onclose}
            >Cancel</Button
        >
        <Button
            variant="filled"
            size="xs"
            disabled={locations.disabled || !changesFolder}
            onclick={move}
        >
            {locations.saving ? 'Moving…' : 'Move here'}
        </Button>
    </div>
</section>

<style>
    .move-panel {
        background: light-dark(var(--np-color-surface), #000);
    }
</style>
