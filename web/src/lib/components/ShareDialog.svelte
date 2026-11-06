<script lang="ts">
    import { Button, Dialog, TextField } from 'noph-ui';
    import type { ShareSummary } from '@madkarmaa/phodrive-core/models';

    interface Props {
        open?: boolean;
        kind: 'file' | 'folder' | null;
        targetName: string;
        busy: boolean;
        error: string;
        result: ShareSummary | null;
        oncreate: (name: string) => void;
        onclose: () => void;
        oncopy: (share: ShareSummary) => void;
    }

    let {
        open = $bindable(false),
        kind,
        targetName,
        busy,
        error,
        result,
        oncreate,
        onclose,
        oncopy
    }: Props = $props();
    let name = $state('');
    let element = $state<HTMLDialogElement>();

    $effect(() => {
        name = targetName;
    });

    // Noph light-dismisses busy dialogs, so keep creation open until it finishes.
    function handleClose() {
        if (busy) {
            element?.showModal();

            return;
        }

        onclose();
    }

    const target = $derived(kind === 'folder' ? 'folder' : 'file');
    const headline = $derived(result ? 'Link created' : `Share this ${target}?`);
    const publicUrl = $derived(
        result ? new URL(result.publicPath, window.location.origin).toString() : ''
    );
</script>

<Dialog bind:element bind:open aria-label={headline} {headline} onclose={handleClose}>
    {#if result}
        <div class="grid gap-3">
            <p class="m-0 text-sm text-muted">
                Anyone with this link can view and download this {target}. Later changes to it do
                not change the share.
            </p>
            <TextField
                label="Public link"
                readonly
                value={publicUrl}
                onfocus={(event) => event.currentTarget.select()}
            />
            {#if error}<p class="m-0 text-sm text-error">{error}</p>{/if}
        </div>
    {:else}
        <div class="grid gap-3">
            <p class="m-0 text-sm text-muted">
                {kind === 'folder'
                    ? 'This share includes the folder and its subfolders, without files in Trash. Creation fails if any other file is incomplete or unreadable.'
                    : 'This link keeps the file as it is now. Later changes will not update it.'}
            </p>
            <TextField
                label="Share name"
                name="shareName"
                bind:value={name}
                disabled={busy}
                maxlength={200}
                required
            />
            {#if error}<p class="m-0 text-sm text-error">{error}</p>{/if}
        </div>
    {/if}

    {#snippet actions()}
        {#if result}
            <Button variant="text" onclick={onclose}>Done</Button>
            <Button variant="tonal" onclick={() => oncopy(result)}>Copy link</Button>
        {:else}
            <Button variant="text" disabled={busy} onclick={onclose}>Cancel</Button>
            <Button
                variant="tonal"
                loading={busy}
                loadingAriaLabel="Creating share"
                disabled={busy || !name.trim()}
                onclick={() => oncreate(name)}
            >
                Create share
            </Button>
        {/if}
    {/snippet}
</Dialog>
