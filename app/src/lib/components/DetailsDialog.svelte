<script lang="ts">
    import { Button, Dialog } from 'noph-ui';
    import prettyBytes from 'pretty-bytes';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import LocalizedDate from '#components/LocalizedDate.svelte';
    import type { EntryTarget } from '#browser/drive/menu-types';
    import { filesUnderPath } from '#lib/folders';

    interface Props {
        open?: boolean;
        target: EntryTarget | null;
        files: readonly FileGroup[];
        owners: readonly string[];
        onclose: () => void;
    }

    let { open = $bindable(false), target, files, owners, onclose }: Props = $props();

    const file = $derived(target?.kind === 'file' ? target.item : null);
    const folder = $derived(target?.kind === 'folder' ? target.entry : null);
    const total = $derived(folder === null ? 0 : filesUnderPath(files, folder.path).length);
    const size = $derived(
        file === null || !file.complete
            ? null
            : file.chunks.reduce((sum, chunk) => sum + chunk.size, 0)
    );
    const status = $derived(
        file === null ? '' : file.trashed ? 'In Trash' : file.complete ? 'Complete' : 'Incomplete'
    );
</script>

<Dialog
    bind:open
    headline="Details"
    ontoggle={(event) => {
        if (event.newState === 'closed') onclose();
    }}
>
    <dl class="details-grid mt-4">
        {#if file}
            <dt>Name</dt>
            <dd>{file.name}</dd>
            <dt>Location</dt>
            <dd>{file.folder || 'My files'}</dd>
            <dt>Owner</dt>
            <dd>{owners.join(', ') || file.email}</dd>
            <dt>Size</dt>
            <dd>{size === null ? 'Unknown' : prettyBytes(size)}</dd>
            <dt>Modified</dt>
            <dd><LocalizedDate timestamp={file.at} /></dd>
            <dt>Chunks</dt>
            <dd>
                {file.chunks.length}
                {#if file.duplicates.length}
                    · {file.duplicates.length} duplicate{file.duplicates.length === 1 ? '' : 's'}
                {/if}
                {#if file.trashedChunks.length}
                    · {file.trashedChunks.length} in Trash
                {/if}
            </dd>
            <dt>Status</dt>
            <dd>{status}</dd>
        {:else if folder}
            <dt>Name</dt>
            <dd>{folder.name}</dd>
            <dt>Location</dt>
            <dd>{folder.path.slice(0, folder.path.lastIndexOf('/')) || 'My files'}</dd>
            <dt>Owners</dt>
            <dd>{owners.join(', ')}</dd>
            <dt>Files</dt>
            <dd>{folder.files}</dd>
            <dt>Subfolders</dt>
            <dd>{folder.subfolders}</dd>
            <dt>Total files</dt>
            <dd>{total}</dd>
        {/if}
    </dl>

    {#snippet actions()}
        <Button variant="text" onclick={onclose}>Close</Button>
    {/snippet}
</Dialog>

<style>
    .details-grid {
        display: grid;
        grid-template-columns: minmax(6rem, max-content) minmax(0, 1fr);
        gap: 8px 20px;
        margin: 0;
        font-size: 14px;
    }

    dt {
        color: var(--app-muted);
    }

    dd {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
    }
</style>
