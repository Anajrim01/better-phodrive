<script lang="ts">
    import { Button, Dialog } from 'noph-ui';
    import type { FolderEntry } from '@madkarmaa/phodrive-core/files';

    interface Props {
        open?: boolean;
        folder: FolderEntry | null;
        count: number;
        error?: string;
        busy: boolean;
        ondelete: () => void;
        onclose: () => void;
    }

    let {
        open = $bindable(false),
        folder,
        count,
        error = '',
        busy,
        ondelete,
        onclose
    }: Props = $props();
    let cancelButton = $state<HTMLElement>();

    const body = $derived(
        folder === null
            ? ''
            : count === 0
              ? `No loaded files remain in ${folder.name}. Refresh to check again.`
              : `This moves every file under ${folder.name} to Google Photos trash, including ${count} loaded ${count === 1 ? 'file' : 'files'}. You can restore them from Trash.`
    );
</script>

<Dialog
    bind:open
    headline="Delete folder and files?"
    supportingText={body}
    ontoggle={(event) => {
        if (event.newState === 'closed') onclose();
        else cancelButton?.focus();
    }}
>
    {#if error}
        <p class="mt-3 text-sm" role="alert">{error}</p>
    {/if}

    {#snippet actions()}
        <Button
            bind:element={cancelButton}
            variant="text"
            disabled={busy}
            onclick={() => (open = false)}
        >
            Cancel
        </Button>
        <Button
            variant="text"
            loading={busy}
            loadingAriaLabel="Moving the folder to trash"
            disabled={count === 0}
            onclick={ondelete}
        >
            Move to trash
        </Button>
    {/snippet}
</Dialog>
