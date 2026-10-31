<script lang="ts">
    import { UploadJobStatus, UploadPhase } from '@madkarmaa/phodrive-core/models';

    import { CircularProgress, IconButton, ListItem } from 'noph-ui';
    import type { UploadJob } from '#browser/files';
    import { uploadJobDetail } from '#browser/upload-status';
    import IconDescription from '~icons/material-symbols/description-outline';
    import IconCheckCircle from '~icons/material-symbols/check-circle-outline';
    import IconError from '~icons/material-symbols/error-outline';
    import IconRetry from '~icons/material-symbols/replay';

    interface Props {
        job: UploadJob;
        retryDisabled: boolean;
        now: number;
        onretry: () => void;
    }

    let { job, retryDisabled, now, onretry }: Props = $props();

    const progress = $derived(job.progress);
    const processed = $derived(
        progress.completed + (progress.phase === UploadPhase.Uploading ? progress.reused : 0)
    );
    const percent = $derived(progress.total ? Math.round((processed / progress.total) * 100) : 0);
    const indeterminate = $derived(progress.phase === UploadPhase.Receiving || !progress.total);
    const detail = $derived(uploadJobDetail(job, now));
</script>

<ListItem class="upload-status-row" variant="text" aria-label={job.name}>
    {#snippet start()}
        <IconDescription aria-hidden="true" class="size-5 shrink-0 text-muted" />
    {/snippet}
    <p class="truncate text-sm" title={job.name}>{job.name}</p>
    {#snippet supportingText()}
        <p
            class="text-xs tabular-nums"
            class:text-error={job.status === UploadJobStatus.Error}
            class:text-muted={job.status !== UploadJobStatus.Error}
            role={job.status === UploadJobStatus.Error ? 'alert' : 'status'}
        >
            {detail}
        </p>
    {/snippet}
    {#snippet end()}
        {#if job.status === UploadJobStatus.Active}
            <CircularProgress
                {indeterminate}
                value={indeterminate ? undefined : percent}
                max={100}
                aria-label="Upload progress"
                --np-circular-progress-size="24px"
            />
        {:else if job.status === UploadJobStatus.Error}
            <IconError aria-hidden="true" class="size-5 shrink-0 text-error" />
            <IconButton
                size="s"
                aria-label={`Retry ${job.name}`}
                title={`Retry ${job.name}`}
                disabled={retryDisabled}
                onclick={onretry}
            >
                <IconRetry aria-hidden="true" />
            </IconButton>
        {:else if job.status === UploadJobStatus.Complete}
            <IconCheckCircle aria-hidden="true" class="size-5 shrink-0 text-success" />
        {/if}
    {/snippet}
</ListItem>

<style>
    :global(:root .upload-status-row.np-item) {
        --np-item-container-height: 64px;
        padding: 12px 16px;
        gap: 12px;
    }
    :global(:root .upload-status-row.np-item .np-item-text) {
        min-width: 0;
    }
    :global(:root .upload-status-row.np-item .np-item-end) {
        align-items: center;
        gap: 4px;
    }
</style>
