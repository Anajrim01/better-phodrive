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
    const body = $derived(
        target?.kind === ConfirmKind.Account
            ? `Sign out of ${target.email} on this browser? Files in Google Photos will stay online.`
            : file === null
              ? ''
              : permanent
                ? `This deletes ${file.name}. This cannot be undone.`
                : deletingRemaining
                  ? `This moves the remaining chunks of ${file.name} to Google Photos trash. You can restore the file from Trash.`
                  : `This moves ${file.name} to Google Photos trash. You can restore it from Trash.`
    );
</script>

<Dialog
    style="transition-property: opacity"
    bind:open
    aria-label={headline}
    {headline}
    supportingText={body}
    ontoggle={(event) => {
        if (event.newState === 'open') cancelButton?.focus();
    }}
>
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
