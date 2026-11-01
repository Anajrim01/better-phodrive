<script lang="ts">
    import { Button, Dialog, Select } from 'noph-ui';
    import type { EntryTarget } from '#browser/drive/menu-types';
    import type { MoveDestination } from '#browser/drive/manage.svelte';

    interface Props {
        open?: boolean;
        target: EntryTarget | null;
        destinations: MoveDestination[];
        value: string;
        error?: string;
        busy: boolean;
        onmove: (destination: string) => void;
        onclose: () => void;
    }

    let {
        open = $bindable(false),
        target,
        destinations,
        value,
        error = '',
        busy,
        onmove,
        onclose
    }: Props = $props();

    let destination = $state('');
    const note = $derived(
        target?.kind === 'folder'
            ? 'This moves the folder in Phodrive only. Google Photos files stay where they are.'
            : 'This moves the file in Phodrive only. Google Photos albums are unchanged.'
    );
    const options = $derived(
        destinations.map((entry) => ({ value: entry.value, label: entry.label }))
    );

    $effect(() => {
        if (!open) return;

        destination = value;
    });

    function submit(): void {
        if (busy) return;

        onmove(destination);
    }
</script>

<Dialog
    bind:open
    headline={target?.kind === 'folder' ? 'Move folder' : 'Move file'}
    supportingText={note}
    ontoggle={(event) => {
        if (event.newState === 'closed') onclose();
    }}
>
    <div class="mt-4">
        <Select
            label="Destination"
            bind:value={destination}
            {options}
            issues={error ? [{ message: error }] : undefined}
            disabled={busy}
        />
    </div>

    {#snippet actions()}
        <Button variant="text" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
        <Button
            variant="text"
            loading={busy}
            loadingAriaLabel="Moving"
            disabled={destination === value}
            onclick={submit}
        >
            Move
        </Button>
    {/snippet}
</Dialog>
