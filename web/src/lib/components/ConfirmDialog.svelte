<script lang="ts">
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import { Button, Dialog } from 'noph-ui';

    interface Props {
        open?: boolean;
        target: FileGroup | null;
        permanent?: boolean;
        onconfirm: () => void;
    }

    let { open = $bindable(false), target, permanent = false, onconfirm }: Props = $props();
    let cancelButton = $state<HTMLElement>();
    const headline = $derived(permanent ? 'Delete forever?' : 'Move file to trash?');
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
    {#if target}
        {#if permanent}
            Delete {target.name} permanently? This cannot be undone.
        {:else}
            Move {target.name} and its {target.chunks.length}
            {target.chunks.length === 1 ? 'chunk' : 'chunks'} to Google Photos trash?
        {/if}
    {/if}

    {#snippet actions()}
        <Button bind:element={cancelButton} autofocus variant="text" onclick={() => (open = false)}>
            Cancel
        </Button>
        <Button variant="text" onclick={onconfirm}
            >{permanent ? 'Delete forever' : 'Move to trash'}</Button
        >
    {/snippet}
</Dialog>
