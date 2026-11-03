<script lang="ts">
    interface Props {
        files: readonly { name: string; complete: boolean }[];
        invalidReason?: string;
    }

    let { files, invalidReason = '' }: Props = $props();

    const VISIBLE_FILE_LIMIT = 5;
    const visibleFiles = $derived(files.slice(0, VISIBLE_FILE_LIMIT));
    const hiddenCount = $derived(Math.max(0, files.length - VISIBLE_FILE_LIMIT));
    const fileCount = $derived(
        files.length === 0
            ? 'No files selected'
            : `${files.length} ${files.length === 1 ? 'file' : 'files'}`
    );
</script>

<div class="share-selection mt-4">
    <p class="share-count">{fileCount}</p>
    {#if visibleFiles.length > 0}
        <ul class="share-files">
            {#each visibleFiles as file}
                <li class="share-file">
                    <span class="share-file-name" title={file.name}>{file.name}</span>
                    {#if !file.complete}
                        <span class="share-file-state">Incomplete</span>
                    {/if}
                </li>
            {/each}
            {#if hiddenCount > 0}
                <li class="share-more">and {hiddenCount} more</li>
            {/if}
        </ul>
    {/if}
    {#if invalidReason}
        <p class="share-error mt-2" role="alert">{invalidReason}</p>
    {/if}
</div>

<style>
    .share-selection {
        border: 1px solid var(--app-border);
        border-radius: 16px;
        background: var(--app-panel);
        padding: 0.625rem 0.75rem;
    }

    .share-count {
        margin: 0;
        color: var(--app-muted);
        font-size: 0.75rem;
        line-height: 1rem;
    }

    .share-files {
        display: grid;
        gap: 0.125rem;
        margin: 0.375rem 0 0;
        padding: 0;
        list-style: none;
    }

    .share-file {
        display: flex;
        min-width: 0;
        align-items: baseline;
        gap: 0.5rem;
        font-size: 0.875rem;
        line-height: 1.25rem;
    }

    .share-file-name {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .share-file-state,
    .share-more {
        flex-shrink: 0;
        color: var(--app-muted);
        font-size: 0.75rem;
        line-height: 1rem;
    }

    .share-error {
        color: var(--np-color-error);
        font-size: 0.875rem;
        line-height: 1.25rem;
    }
</style>
