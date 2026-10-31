<script lang="ts">
    import { IconButton, List, Sheet } from 'noph-ui';
    import { formatDuration, remainingSeconds } from '@madkarmaa/phodrive-core/browser/upload/eta';
    import { UploadJobStatus, UploadPhase } from '@madkarmaa/phodrive-core/models';

    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { UploadJob } from '#browser/files';
    import UploadStatusRow from '#components/UploadStatusRow.svelte';
    import IconClose from '~icons/material-symbols/close';
    import IconExpandMore from '~icons/material-symbols/expand-more';

    interface Props {
        open?: boolean;
        busy: boolean;
        jobs: readonly UploadJob[];
        retryDisabled: boolean;
        onretry: (id: number) => void;
    }

    let { open = $bindable(false), busy, jobs, retryDisabled, onretry }: Props = $props();

    let collapsed = $state(false);
    const orderedJobs = $derived(
        jobs.toSorted(
            (first, second) =>
                Number(second.status === UploadJobStatus.Error) -
                Number(first.status === UploadJobStatus.Error)
        )
    );
    const pending = $derived(
        jobs.filter(
            (job) => job.status === UploadJobStatus.Queued || job.status === UploadJobStatus.Active
        )
    );
    const remaining = $derived(pending.length);
    const remainingBytes = $derived(
        pending.reduce((sum, job) => {
            const progress = job.progress;
            const processed =
                progress.completed +
                (progress.phase === UploadPhase.Uploading ? progress.reused : 0);

            return sum + Math.max(0, progress.total - processed);
        }, 0)
    );
    const aggregateRate = $derived(
        jobs.reduce(
            (sum, job) => sum + (job.status === UploadJobStatus.Active ? job.bytesPerSecond : 0),
            0
        )
    );
    const eta = $derived(busy ? remainingSeconds(remainingBytes, aggregateRate) : null);
    const paused = $derived(pending.filter((job) => job.retryAt !== null));
    let now = $state(Date.now());

    $effect(() => {
        if (!busy || !paused.length) return;

        now = Date.now();
        const timer = setInterval(() => (now = Date.now()), 1_000);

        return () => clearInterval(timer);
    });

    const failures = $derived(jobs.filter((job) => job.status === UploadJobStatus.Error).length);
    const heading = $derived.by(() => {
        if (busy) {
            if (paused.length) return `${remaining} ${remaining === 1 ? 'item' : 'items'} waiting`;

            const label = `Uploading ${remaining} ${remaining === 1 ? 'item' : 'items'}`;
            if (eta === null) return label;

            return `${label}, about ${formatDuration(eta)} left`;
        }
        if (failures) return `${failures} ${failures === 1 ? 'upload' : 'uploads'} failed`;
        if (remaining)
            return `${remaining} ${remaining === 1 ? 'upload is' : 'uploads are'} waiting for an account`;

        return `${jobs.length} ${jobs.length === 1 ? 'upload' : 'uploads'} complete`;
    });
</script>

<Sheet
    bind:open
    modal={false}
    handle={false}
    placement="bottom"
    aria-label="Upload status"
    class="upload-sheet"
>
    <header class="flex min-h-14 items-center gap-1 bg-surface py-1 pr-2 pl-4">
        <div class="mr-auto min-w-0" aria-live="polite">
            <h2 class="text-base font-medium">{heading}</h2>
            {#if busy && paused.length}
                <p class="text-xs text-muted">Google Photos is limiting requests</p>
            {/if}
        </div>
        <IconButton
            size="s"
            aria-label={collapsed ? 'Expand upload status' : 'Minimise upload status'}
            aria-expanded={!collapsed}
            onclick={() => (collapsed = !collapsed)}
        >
            <IconExpandMore
                aria-hidden="true"
                class={[
                    'transition-transform duration-150 ease-(--app-ease)',
                    collapsed && 'rotate-180'
                ]}
            />
        </IconButton>
        <IconButton
            size="s"
            aria-label="Close upload status"
            title="Close upload status"
            onclick={() => (open = false)}><IconClose aria-hidden="true" /></IconButton
        >
    </header>

    {#if !collapsed}
        <div transition:fade={{ duration: prefersReducedMotion.current ? 0 : 140 }}>
            <List class="upload-queue" aria-label="Upload queue">
                {#each orderedJobs as job (job.id)}
                    <UploadStatusRow {job} {retryDisabled} {now} onretry={() => onretry(job.id)} />
                {/each}
            </List>
        </div>
    {/if}
</Sheet>

<style>
    :global(:root .upload-sheet.np-sheet) {
        inset: auto 24px 0 auto;
        width: 360px;
        max-width: calc(100vw - 32px);
        max-height: calc(60vh + 56px);
        border: 1px solid var(--app-border);
        border-bottom: none;
        --np-sheet-z-index: 30;
        --np-sheet-shape: 16px 16px 0 0;
        --np-sheet-elevation: none;
    }

    :global(:root .upload-sheet.np-sheet > .np-sheet-content) {
        padding: 0;
    }
    :global(:root .upload-queue.np-list) {
        padding: 0;
        margin: 0;
    }

    @media (max-width: 520px) {
        :global(:root .upload-sheet.np-sheet) {
            right: 16px;
        }
    }
</style>
