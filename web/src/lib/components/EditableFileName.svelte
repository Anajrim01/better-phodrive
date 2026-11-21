<script lang="ts">
    import { Button, IconButton } from 'noph-ui';
    import { getContext, onMount, tick } from 'svelte';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import {
        FILE_LOCATION_CONTROLS,
        type DriveFileLocations
    } from '#browser/drive/file-locations.svelte';
    import IconEdit from '~icons/material-symbols/edit-outline';

    let { file, heading = false }: { file: FileGroup; heading?: boolean } = $props();
    const readLocations = getContext<(() => DriveFileLocations) | undefined>(
        FILE_LOCATION_CONTROLS
    );
    const locations = $derived(readLocations?.());
    const renaming = $derived(locations?.isRenaming(file));
    let name = $state('');
    let field = $state<HTMLInputElement>();
    let editButton = $state<HTMLElement>();

    async function begin() {
        name = file.name;
        locations?.startRename(file);
        await tick();
        field?.focus();
        field?.select();
    }

    async function cancel() {
        locations?.closeRename();
        await tick();
        editButton?.focus();
    }

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        await locations?.rename(file, name);
        await tick();
        if (!renaming) editButton?.focus();
    }

    onMount(() => () => {
        if (locations && renaming && !locations.saving) locations.closeRename();
    });
</script>

{#if locations}
    <div
        class="flex min-w-0 flex-1 items-center gap-2"
        data-file-selected={locations.isSelected(file)}
    >
        <input
            type="checkbox"
            class="shrink-0 accent-primary"
            aria-label={`Select ${file.name}`}
            checked={locations.isSelected(file)}
            disabled={!locations.canSelect(file)}
            onchange={(event) => locations.select(file, event.currentTarget.checked)}
        />
        {#if renaming}
            <form
                class="inline-rename flex min-w-0 flex-1 flex-wrap items-center gap-1"
                onsubmit={submit}
            >
                <input
                    type="text"
                    class="min-h-8 min-w-0 flex-1 basis-24 rounded-[3px] border border-[#c5d7ed] bg-black px-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c5d7ed]"
                    aria-label="File name"
                    bind:this={field}
                    bind:value={name}
                    maxlength={255}
                    disabled={locations.saving}
                    onkeydown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.stopPropagation();
                        void cancel();
                    }}
                />
                <Button
                    type="button"
                    size="xs"
                    shape="square"
                    variant="outlined"
                    disabled={locations.saving}
                    onclick={cancel}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    size="xs"
                    shape="square"
                    variant="filled"
                    disabled={locations.disabled || !name}
                >
                    Save
                </Button>
                {#if locations.error}
                    <span role="alert" class="basis-full text-xs text-error">{locations.error}</span
                    >
                {/if}
            </form>
        {:else}
            <svelte:element
                this={heading ? 'h3' : 'span'}
                class="m-0 block min-w-0 flex-1 truncate text-sm font-medium"
                title={file.name}>{file.name}</svelte:element
            >
            {#if locations.canEdit(file)}
                <IconButton
                    size="xs"
                    title={`Rename ${file.name}`}
                    disabled={locations.disabled || locations.moving}
                    bind:element={editButton}
                    onclick={begin}
                >
                    <IconEdit aria-hidden="true" />
                </IconButton>
            {/if}
        {/if}
    </div>
{:else}
    <span class="block truncate text-sm font-medium" title={file.name}>{file.name}</span>
{/if}

<style>
    .inline-rename {
        --np-button-shape: 3px;
        --np-filled-button-container-color: #e4edfa;
        --np-filled-button-label-text-color: #111;
    }
</style>
