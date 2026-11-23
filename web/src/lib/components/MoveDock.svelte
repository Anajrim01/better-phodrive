<script lang="ts">
    import { Button, TextField } from 'noph-ui';
    import { tick } from 'svelte';
    import type { DriveFileLocations } from '#browser/drive/file-locations.svelte';

    /** Bottom bar for move mode: the folder open in the files view is the destination. */
    let {
        locations,
        onclose
    }: { locations: DriveFileLocations; onclose: (moved: boolean) => void } = $props();
    let newFolder = $state<string | null>(null);
    let newFolderInput = $state<HTMLInputElement | HTMLTextAreaElement>();

    async function startNewFolder() {
        newFolder = '';
        await tick();
        newFolderInput?.focus();
    }

    async function closeMove() {
        locations.closeMove();
        await tick();
        onclose(false);
    }

    async function moveHere(event: SubmitEvent) {
        event.preventDefault();
        await locations.move(newFolder ?? '');
        if (locations.moving) return;
        await tick();
        onclose(true);
    }
</script>

<form
    class="move-dock sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-2 border-t border-border bg-panel py-3"
    aria-label="Move files"
    onsubmit={moveHere}
>
    <span class="mr-auto text-sm font-medium" role="status">
        Moving {locations.selected.length}
        {locations.selected.length === 1 ? 'file' : 'files'}
    </span>
    {#if locations.error}
        <span role="alert" class="basis-full text-xs text-error">{locations.error}</span>
    {/if}
    {#if newFolder === null}
        <Button
            type="button"
            variant="text"
            size="s"
            disabled={locations.disabled}
            onclick={startNewFolder}>New folder</Button
        >
    {:else}
        <TextField
            label="New folder"
            bind:value={newFolder}
            bind:inputElement={newFolderInput}
            disabled={locations.saving}
        />
    {/if}
    <Button type="button" variant="text" size="s" disabled={locations.saving} onclick={closeMove}
        >Cancel</Button
    >
    <Button
        type="submit"
        variant="filled"
        size="s"
        disabled={locations.disabled ||
            (newFolder === null ? !locations.movesHere : !newFolder.trim())}
    >
        {locations.saving ? 'Moving…' : newFolder === null ? 'Move here' : 'Move into folder'}
    </Button>
</form>
