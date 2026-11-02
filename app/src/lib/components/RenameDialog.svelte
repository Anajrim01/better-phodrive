<script lang="ts">
    import { Button, Dialog, TextField } from 'noph-ui';
    import { FileNameSchema } from '@madkarmaa/phodrive-core/models';
    import type { EntryTarget } from '#browser/drive/menu-types';
    import { targetName } from '#browser/drive/manage-types';

    interface Props {
        open?: boolean;
        target: EntryTarget | null;
        error?: string;
        busy: boolean;
        onrename: (name: string) => void;
        onclose: () => void;
    }

    let { open = $bindable(false), target, error = '', busy, onrename, onclose }: Props = $props();

    let name = $state('');
    let input = $state<HTMLInputElement | HTMLTextAreaElement>();
    const current = $derived(target === null ? '' : targetName(target));
    const valid = $derived(FileNameSchema.safeParse(name).success);
    const note = $derived(
        target?.kind === 'folder'
            ? 'Only the Phodrive folder name changes. The Google Photos album keeps its name.'
            : 'Only the Phodrive file name changes. The file in Google Photos keeps its name.'
    );

    $effect(() => {
        if (!open || !target) return;

        name = current;
    });

    function submit(): void {
        if (!valid || busy) return;

        onrename(name);
    }
</script>

<Dialog
    bind:open
    headline={target?.kind === 'folder' ? 'Rename folder' : 'Rename file'}
    supportingText={note}
    ontoggle={(event) => {
        if (event.newState === 'closed') {
            onclose();

            return;
        }

        queueMicrotask(() => {
            input?.focus();
            input?.select();
        });
    }}
>
    <form
        class="mt-4"
        novalidate
        onsubmit={(event) => {
            event.preventDefault();
            submit();
        }}
    >
        <TextField
            label="Name"
            bind:value={name}
            bind:inputElement={input}
            issues={error ? [{ message: error }] : undefined}
            disabled={busy}
            autocomplete="off"
            required
        />
    </form>

    {#snippet actions()}
        <Button variant="text" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
        <Button
            variant="text"
            loading={busy}
            loadingAriaLabel="Saving the new name"
            disabled={!valid || name === current}
            onclick={submit}
        >
            Save
        </Button>
    {/snippet}
</Dialog>
