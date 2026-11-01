<script lang="ts">
    import { Button, Dialog } from 'noph-ui';
    import prettyBytes from 'pretty-bytes';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import LocalizedDate from '#components/LocalizedDate.svelte';
    import type { EntryTarget } from '#browser/drive/menu-types';
    import { selectionSummary } from '#browser/drive/selection-files';
    import { filesUnderPath } from '#lib/folders';

    interface Props {
        open?: boolean;
        target: EntryTarget | null;
        files: readonly FileGroup[];
        owners: readonly string[];
        selection?: readonly FileGroup[] | null;
        onclose: () => void;
    }

    let {
        open = $bindable(false),
        target,
        files,
        owners,
        selection = null,
        onclose
    }: Props = $props();

    const file = $derived(target?.kind === 'file' ? target.item : null);
    const folder = $derived(target?.kind === 'folder' ? target.entry : null);
    const summary = $derived(selection === null ? null : selectionSummary(selection));
    const total = $derived(folder === null ? 0 : filesUnderPath(files, folder.path).length);
    const size = $derived(
        file === null || !file.complete
            ? null
            : file.chunks.reduce((sum, chunk) => sum + chunk.size, 0)
    );
    const status = $derived(
        file === null ? '' : file.trashed ? 'In Trash' : file.complete ? 'Complete' : 'Incomplete'
    );
    const summarySize = $derived(
        summary === null
            ? ''
            : summary.incomplete === summary.count
              ? 'Unknown'
              : `${prettyBytes(summary.size)}${summary.incomplete > 0 ? ' known' : ''}`
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
        {:else if summary}
            <dt>Files</dt>
            <dd>{summary.count}</dd>
            <dt>Total size</dt>
            <dd>{summarySize}</dd>
            <dt>Owners</dt>
            <dd>{summary.owners.join(', ')}</dd>
            <dt>Incomplete</dt>
            <dd>{summary.incomplete}</dd>
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
