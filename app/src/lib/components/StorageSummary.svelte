<script lang="ts">
    import { LoadingIndicator } from 'noph-ui';
    import prettyBytes from 'pretty-bytes';
    import type { LibraryStats } from '@madkarmaa/phodrive-core/stats';

    interface Props {
        stats: LibraryStats | null;
        hasMore: boolean;
    }

    let { stats, hasMore }: Props = $props();

    type Segment = { type: string; files: number; bytes: number; color: string };

    const PRIMARY_COLOR = 'var(--np-color-primary)';
    const SECONDARY_COLOR = 'var(--np-color-secondary)';
    const TERTIARY_COLOR = 'var(--np-color-tertiary)';
    const OTHER_COLOR = 'var(--np-color-surface-variant)';
    const TYPE_COLORS = [PRIMARY_COLOR, SECONDARY_COLOR, TERTIARY_COLOR];

    const segments = $derived.by((): Segment[] => {
        if (!stats) return [];

        const shown = stats.types.slice(0, TYPE_COLORS.length);
        const rest = stats.types.slice(TYPE_COLORS.length);
        const other = rest.reduce(
            (total, entry) => ({
                type: 'Other',
                files: total.files + entry.files,
                bytes: total.bytes + entry.bytes,
                color: OTHER_COLOR
            }),
            { type: 'Other', files: 0, bytes: 0, color: OTHER_COLOR }
        );
        const entries: Segment[] = shown.map((entry, index) => ({
            ...entry,
            color: TYPE_COLORS[index] ?? OTHER_COLOR
        }));

        if (other.files > 0) entries.push(other);

        return entries.filter((entry) => entry.bytes > 0);
    });

    const filesLabel = $derived(
        stats ? `${stats.files} ${stats.files === 1 ? 'file' : 'files'}` : ''
    );
    const foldersLabel = $derived(
        stats ? `${stats.folders} ${stats.folders === 1 ? 'folder' : 'folders'}` : ''
    );
</script>

<section class="storage-summary" aria-labelledby="storage-heading">
    <h2 id="storage-heading" class="storage-heading">Storage</h2>

    {#if stats}
        <p class="storage-total">{prettyBytes(stats.bytes)}</p>
        <p class="storage-count">{filesLabel} · {foldersLabel}</p>

        {#if stats.incompleteFiles > 0}
            <p class="storage-note">{stats.incompleteFiles} incomplete</p>
        {/if}

        {#if hasMore}
            <p class="storage-note">Load more files for a full total</p>
        {/if}

        {#if segments.length}
            <div class="storage-bar" aria-hidden="true">
                {#each segments as segment (segment.type)}
                    <span
                        class="storage-segment"
                        style:flex-grow={segment.bytes}
                        style:background-color={segment.color}
                    ></span>
                {/each}
            </div>

            <ul class="storage-legend">
                {#each segments as segment (segment.type)}
                    <li class="legend-item">
                        <span
                            class="legend-dot"
                            style:background-color={segment.color}
                            aria-hidden="true"
                        ></span>
                        <span class="legend-name">{segment.type}</span>
                        <span class="legend-meta">
                            {prettyBytes(segment.bytes)} · {segment.files}
                            {segment.files === 1 ? 'file' : 'files'}
                        </span>
                    </li>
                {/each}
            </ul>
        {/if}
    {:else}
        <div class="storage-loading">
            <LoadingIndicator aria-label="Loading storage totals" />
        </div>
    {/if}
</section>

<style>
    .storage-summary {
        border-top: 1px solid var(--app-border);
        padding: 12px 24px 0;
        font-size: 13px;
    }

    .storage-heading {
        margin: 0 0 6px;
        color: var(--app-muted);
        font-size: 12px;
        font-weight: 500;
    }

    .storage-total {
        margin: 0;
        font-size: 22px;
        font-weight: 500;
        line-height: 1.2;
    }

    .storage-count {
        margin: 2px 0 0;
        font-size: 13px;
    }

    .storage-note {
        margin: 2px 0 0;
        color: var(--app-muted);
        font-size: 12px;
        line-height: 1.35;
    }

    .storage-loading {
        display: flex;
        align-items: center;
        min-height: 48px;
    }

    .storage-bar {
        display: flex;
        gap: 2px;
        height: 8px;
        margin-top: 12px;
    }

    .storage-segment {
        flex-basis: 0;
        min-width: 4px;
        border-radius: 999px;
    }

    .storage-legend {
        display: grid;
        gap: 6px;
        margin: 10px 0 0;
        padding: 0;
        list-style: none;
    }

    .legend-item {
        display: grid;
        grid-template-columns: 8px minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
    }

    .legend-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .legend-meta {
        color: var(--app-muted);
        font-size: 12px;
        white-space: nowrap;
    }

    @media (width < 800px) {
        .storage-summary {
            padding-inline: 12px;
        }
    }
</style>
