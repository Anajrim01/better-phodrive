<script lang="ts">
    import { ConfirmKind } from '@madkarmaa/phodrive-core/models';
    import { Button, Dialog } from 'noph-ui';
    import type { ConfirmTarget } from '#browser/drive/index.svelte';

    interface Props {
        open?: boolean;
        target: ConfirmTarget | null;
        onconfirm: () => void;
    }

    let { open = $bindable(false), target, onconfirm }: Props = $props();
    let cancelButton = $state<HTMLElement>();

    const file = $derived(
        target?.kind === ConfirmKind.File || target?.kind === ConfirmKind.PermanentDelete
            ? target.item
            : null
    );
    const permanent = $derived(target?.kind === ConfirmKind.PermanentDelete);
    const deletingRemaining = $derived(file !== null && !file.complete);
    const headline = $derived(
        target?.kind === ConfirmKind.Account
            ? 'Sign out?'
            : permanent
              ? 'Delete forever?'
              : deletingRemaining
                ? 'Delete remaining chunks?'
                : 'Move file to trash?'
    );
    const remainingChunks = $derived(file?.chunks.length ?? 0);
</script>

<Dialog
    style="transition-property: opacity"
    bind:open
    aria-label={headline}
    {headline}
    ontoggle={(event) => {
        if (event.newState === 'open') cancelButton?.focus();
    }}
>
    {#if target?.kind === ConfirmKind.Account}
        Sign out of {target.email} on this browser? Files in Google Photos will stay online.
    {:else if file}
        {#if permanent}
            Permanently delete {file.name} and its {remainingChunks}
            {remainingChunks === 1 ? 'chunk' : 'chunks'}? This cannot be undone.
        {:else if deletingRemaining}
            Move the remaining {remainingChunks}
            {remainingChunks === 1 ? 'chunk' : 'chunks'} of {file.name} to Google Photos trash? This file
            cannot be downloaded after that.
        {:else}
            Move {file.name} and its {remainingChunks}
            {remainingChunks === 1 ? 'chunk' : 'chunks'} to Google Photos trash?
        {/if}
    {/if}

    {#snippet actions()}
        <Button bind:element={cancelButton} autofocus variant="text" onclick={() => (open = false)}>
            Cancel
        </Button>
        <Button variant="text" onclick={onconfirm}>
            {target?.kind === ConfirmKind.Account
                ? 'Sign out'
                : permanent
                  ? 'Delete forever'
                  : deletingRemaining
                    ? 'Delete remaining chunks'
                    : 'Move to trash'}
        </Button>
    {/snippet}
</Dialog>
