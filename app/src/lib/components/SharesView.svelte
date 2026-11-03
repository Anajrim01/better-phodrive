<script lang="ts">
    import { Button } from 'noph-ui';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { ShareRecord } from '@madkarmaa/phodrive-core/share-models';
    import LocalizedDate from '#components/LocalizedDate.svelte';
    import IconLink from '~icons/material-symbols/link';
    import IconContentCopy from '~icons/material-symbols/content-copy';
    import IconOpen from '~icons/material-symbols/open-in-new';
    import IconDelete from '~icons/material-symbols/delete-outline';

    interface Props {
        records: readonly ShareRecord[];
        fileCounts: ReadonlyMap<string, number>;
        copyState: 'idle' | 'copied' | 'manual' | 'failed';
        copiedKey: string;
        copyError?: string;
        revokeNotice?: string;
        shareAvailable?: boolean;
        oncopy: (record: ShareRecord) => void;
        onrevoke: (record: ShareRecord) => void;
    }

    let {
        records,
        fileCounts,
        copyState,
        copiedKey,
        copyError = '',
        revokeNotice = '',
        shareAvailable = true,
        oncopy,
        onrevoke
    }: Props = $props();

    const MANUAL_COPY_MESSAGE =
        'This browser could not copy the link automatically. Select the link below and copy it.';
    const FAILED_COPY_MESSAGE = 'The link could not be copied. Select it below and copy it.';
    const failedCopyMessage = $derived(copyError || FAILED_COPY_MESSAGE);
</script>

<section
    class="flex flex-1 flex-col"
    aria-labelledby="shares-heading"
    in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}
>
    <div class="workspace-heading">
        <h1 id="shares-heading" class="min-w-0">
            Shares <span class="text-subtle tabular-nums">({records.length})</span>
        </h1>
    </div>
    <p class="m-0 mb-6 max-w-180 text-sm text-muted">
        Links created in this browser are listed here. Anyone with a link can open it until you
        revoke it.
    </p>

    {#if !shareAvailable}
        <p
            class="mt-0 mb-4 max-w-180 rounded-2xl border border-border px-4 py-3 text-sm text-muted"
            role="status"
        >
            Sharing isn't available yet. You can still open, copy, or revoke any links listed here.
        </p>
    {/if}

    {#if revokeNotice}
        <p class="mt-0 mb-4 text-sm text-muted" role="status">{revokeNotice}</p>
    {/if}

    {#if records.length === 0}
        <div class="flex max-w-180 items-start gap-3 rounded-2xl border border-border p-5">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-muted">
                <IconLink class="size-5" aria-hidden="true" />
            </span>
            <div class="min-w-0">
                <p class="text-sm font-medium">No share links yet</p>
                <p class="mt-1 text-xs leading-relaxed text-muted">
                    {shareAvailable
                        ? 'Share files from My files. Links you create appear here.'
                        : 'Creating new links is paused until the viewer is available.'}
                </p>
            </div>
        </div>
    {:else}
        <ul
            class="max-w-180 divide-y divide-border/40 overflow-hidden rounded-2xl border border-border"
        >
            {#each records as record (record.envelopeKey)}
                {@const count = fileCounts.get(record.envelopeKey)}
                <li class="grid gap-3 px-4 py-3">
                    <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div class="min-w-0 flex-1">
                            <p class="m-0 truncate text-sm font-medium">{record.name}</p>
                            <p
                                class="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted"
                            >
                                <LocalizedDate timestamp={record.createdAt} />
                                {#if count !== undefined}
                                    <span aria-hidden="true">·</span>
                                    <span>{count} {count === 1 ? 'file' : 'files'}</span>
                                {/if}
                            </p>
                        </div>
                        <div class="share-actions flex flex-wrap items-center gap-1">
                            <Button
                                variant="text"
                                size="s"
                                aria-label={`Copy link to ${record.name}`}
                                onclick={() => oncopy(record)}
                            >
                                {#snippet start()}<IconContentCopy aria-hidden="true" />{/snippet}
                                Copy link
                            </Button>
                            <Button
                                variant="text"
                                size="s"
                                href={record.shareUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open ${record.name}`}
                            >
                                {#snippet start()}<IconOpen aria-hidden="true" />{/snippet}
                                Open
                            </Button>
                            <Button
                                variant="text"
                                size="s"
                                aria-label={`Revoke link to ${record.name}`}
                                onclick={() => onrevoke(record)}
                            >
                                {#snippet start()}<IconDelete aria-hidden="true" />{/snippet}
                                Revoke
                            </Button>
                        </div>
                    </div>

                    {#if copiedKey === record.envelopeKey && copyState === 'copied'}
                        <p class="m-0 text-xs text-muted" role="status">Link copied</p>
                    {:else if copiedKey === record.envelopeKey && (copyState === 'manual' || copyState === 'failed')}
                        <div class="grid gap-2">
                            <p class="m-0 text-xs text-muted" role="status">
                                {copyState === 'failed' ? failedCopyMessage : MANUAL_COPY_MESSAGE}
                            </p>
                            <input
                                readonly
                                value={record.shareUrl}
                                aria-label={`Share link for ${record.name}`}
                                spellcheck="false"
                                autocomplete="off"
                                class="w-full min-w-0 rounded-lg border border-border bg-search px-3 py-2 font-mono text-xs text-text"
                                onfocus={(event) => event.currentTarget.select()}
                                onclick={(event) => event.currentTarget.select()}
                            />
                        </div>
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
</section>

<style>
    .share-actions :global(.np-button) {
        --np-button-padding: 8px;
        --np-button-gap: 6px;
        --np-text-button-label-text-color: var(--app-muted);
    }
</style>
