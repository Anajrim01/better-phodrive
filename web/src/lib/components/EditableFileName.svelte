<script lang="ts">
    import { Button } from 'noph-ui';
    import { getContext, onMount, tick } from 'svelte';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import {
        FILE_LOCATION_CONTROLS,
        type DriveFileLocations
    } from '#browser/drive/file-locations.svelte';

    let { file, heading = false }: { file: FileGroup; heading?: boolean } = $props();
    const readLocations = getContext<(() => DriveFileLocations) | undefined>(
        FILE_LOCATION_CONTROLS
    );
    const locations = $derived(readLocations?.());
    const renaming = $derived(!!locations?.isRenaming(file));
    let name = $state('');
    let field = $state<HTMLInputElement>();
    let label = $state<HTMLElement>();

    // Rename starts from the row actions; open the field with the current name selected.
    $effect(() => {
        if (!renaming) return;
        name = file.name;
        void tick().then(() => {
            field?.focus();
            field?.select();
        });
    });

    async function finish() {
        await tick();
        if (!renaming) label?.focus();
    }

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        await locations?.rename(file, name);
        await finish();
    }

    function cancel() {
        locations?.closeRename();
        void finish();
    }

    onMount(() => () => {
        if (locations && renaming && !locations.saving) locations.closeRename();
    });
</script>

{#if locations && renaming}
    <form class="flex min-w-0 flex-1 flex-wrap items-center gap-1" onsubmit={submit}>
        <input
            type="text"
            class="min-h-8 min-w-0 flex-1 basis-24 rounded border border-primary bg-surface px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="File name"
            bind:this={field}
            bind:value={name}
            maxlength={255}
            disabled={locations.saving}
            onkeydown={(event) => {
                if (event.key !== 'Escape') return;
                event.stopPropagation();
                cancel();
            }}
        />
        <Button type="submit" variant="text" size="xs" disabled={locations.disabled || !name.trim()}
            >Save</Button
        >
        <Button type="button" variant="text" size="xs" disabled={locations.saving} onclick={cancel}
            >Cancel</Button
        >
        {#if locations.error}
            <span role="alert" class="basis-full text-xs text-error">{locations.error}</span>
        {/if}
    </form>
{:else}
    <svelte:element
        this={heading ? 'h3' : 'span'}
        bind:this={label}
        tabindex="-1"
        class="m-0 block min-w-0 flex-1 truncate text-sm font-medium"
        title={file.name}>{file.name}</svelte:element
    >
{/if}
