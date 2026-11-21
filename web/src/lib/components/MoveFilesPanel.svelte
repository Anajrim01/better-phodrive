<script lang="ts">
    import { Button } from 'noph-ui';
    import { onMount, tick } from 'svelte';
    import { folderTrail } from '@madkarmaa/phodrive-core/files';
    import type { DriveFileLocations } from '#browser/drive/file-locations.svelte';
    import IconChevronRight from '~icons/material-symbols/chevron-right';
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
    const trail = $derived([
        { path: '', name: locations.destinationLabel ?? 'Files' },
        ...folderTrail(locations.destination)
    ]);
    const destination = $derived(trail.map((crumb) => crumb.name).join(' / '));
    const count = $derived(locations.selected.length);
    const changesFolder = $derived(
        locations.selected.some((item) => item.folder !== locations.destination)
    );
    const id = $props.id();
    const destinationId = id + '-destination';
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

<section class="move-panel min-w-0 border border-border text-sm text-text" aria-labelledby={id}>
    <header class="border-b border-border px-3 py-2">
        <h2
            class="m-0 text-sm font-semibold"
            {id}
            bind:this={heading}
            tabindex="-1"
            aria-describedby={destinationId}
        >
            Move {count}
            {count === 1 ? 'file' : 'files'}
        </h2>
    </header>
    <nav aria-label="Destination folder" class="flex flex-wrap items-center gap-x-2 px-3 py-2">
        {#each trail as crumb (crumb.path)}
            {#if crumb.path}
                <span class="text-muted" aria-hidden="true">/</span>
            {/if}
            {#if crumb.path === locations.destination}
                <span class="max-w-full truncate font-medium" aria-current="location"
                    >{crumb.name}</span
                >
            {:else}
                <button
                    type="button"
                    class="max-w-full truncate text-left text-muted hover:underline"
                    disabled={locations.saving}
                    onclick={() => openFolder(crumb.path)}>{crumb.name}</button
                >
            {/if}
        {/each}
    </nav>
    {#key locations.destination}
        <ul class="m-0 max-h-72 list-none divide-y divide-border overflow-y-auto p-0">
            {#each locations.folders as folder (folder.path)}
                <li>
                    <button
                        type="button"
                        class="flex min-h-8 w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                        disabled={locations.saving}
                        onclick={() => openFolder(folder.path)}
                    >
                        <IconFolder class="size-4 shrink-0 text-muted" aria-hidden="true" />
                        <span class="min-w-0 flex-1 break-words">{folder.name}</span>
                        <IconChevronRight class="size-4 shrink-0 text-muted" aria-hidden="true" />
                    </button>
                </li>
            {/each}
        </ul>
    {/key}
    {#if hasMore}
        <div class="px-2">
            <Button
                variant="text"
                shape="square"
                size="xs"
                disabled={locations.disabled || !count}
                onclick={onmore}
            >
                {loading ? 'Loading folders…' : 'Load more folders'}
            </Button>
        </div>
    {/if}
    {#if locations.error}
        <p role="alert" class="m-0 px-3 py-2 text-sm text-error">{locations.error}</p>
    {/if}
    <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3 py-2">
        <span
            class="min-w-0 flex-1 truncate text-xs text-muted"
            id={destinationId}
            title={destination}>{destination}</span
        >
        <Button
            variant="outlined"
            shape="square"
            size="xs"
            disabled={locations.saving}
            onclick={onclose}>Cancel</Button
        >
        <Button
            variant="filled"
            shape="square"
            size="xs"
            disabled={locations.disabled || !changesFolder}
            onclick={move}
        >
            {locations.saving ? 'Moving…' : 'Move here'}
        </Button>
    </footer>
</section>

<style>
    .move-panel {
        background: light-dark(var(--np-color-surface), #000);
        --np-button-shape: 3px;
        --np-filled-button-container-color: light-dark(var(--np-color-primary), #e4edfa);
        --np-filled-button-label-text-color: light-dark(var(--np-color-on-primary), #111);
    }
</style>
