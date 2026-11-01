<script lang="ts">
    import { Button, IconButton } from 'noph-ui';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import IconDownload from '~icons/material-symbols/download';
    import IconMove from '~icons/material-symbols/drive-file-move-outline';
    import IconDelete from '~icons/material-symbols/delete-outline';
    import IconDeleteForever from '~icons/material-symbols/delete-forever';
    import IconRestore from '~icons/material-symbols/restore-from-trash';
    import IconDetails from '~icons/material-symbols/info';
    import IconClose from '~icons/material-symbols/close';

    interface Props {
        count: number;
        trash: boolean;
        disabled: boolean;
        running: FileActionKind | null;
        progressDone?: number;
        progressTotal?: number;
        ondownload: () => void;
        onmove: () => void;
        ondelete: () => void;
        onrestore: () => void;
        ondeleteforever: () => void;
        ondetails: () => void;
        onclear: () => void;
    }

    let {
        count,
        trash,
        disabled,
        running,
        progressDone = 0,
        progressTotal = 0,
        ondownload,
        onmove,
        ondelete,
        onrestore,
        ondeleteforever,
        ondetails,
        onclear
    }: Props = $props();

    const PROGRESS_LABEL: Record<FileActionKind, string> = {
        [FileActionKind.Download]: 'Downloading',
        [FileActionKind.Delete]: 'Deleting',
        [FileActionKind.Restore]: 'Restoring',
        [FileActionKind.DeleteForever]: 'Deleting'
    };
    const countLabel = $derived(
        running !== null && progressTotal > 0
            ? `${PROGRESS_LABEL[running]} ${progressDone} of ${progressTotal}`
            : `${count} selected`
    );
</script>

<div
    class="selection-bar"
    role="toolbar"
    aria-label="Selection actions"
    in:fade={{ duration: prefersReducedMotion.current ? 0 : 120 }}
>
    <span class="count" aria-live="polite">{countLabel}</span>
    <div class="actions">
        {#if trash}
            <Button
                variant="text"
                size="s"
                aria-label="Restore selected files"
                title="Restore selected files"
                {disabled}
                loading={running === FileActionKind.Restore}
                loadingAriaLabel="Restoring selected files"
                onclick={onrestore}
            >
                {#snippet start()}<IconRestore aria-hidden="true" />{/snippet}
                <span class="action-label">Restore</span>
            </Button>
            <Button
                variant="text"
                size="s"
                aria-label="Delete selected files forever"
                title="Delete selected files forever"
                {disabled}
                loading={running === FileActionKind.DeleteForever}
                loadingAriaLabel="Deleting selected files forever"
                onclick={ondeleteforever}
            >
                {#snippet start()}<IconDeleteForever aria-hidden="true" />{/snippet}
                <span class="action-label">Delete forever</span>
            </Button>
        {:else}
            <Button
                variant="text"
                size="s"
                aria-label="Download selected files"
                title="Download selected files"
                {disabled}
                loading={running === FileActionKind.Download}
                loadingAriaLabel="Downloading selected files"
                onclick={ondownload}
            >
                {#snippet start()}<IconDownload aria-hidden="true" />{/snippet}
                <span class="action-label">Download</span>
            </Button>
            <Button
                variant="text"
                size="s"
                aria-label="Move selected files"
                title="Move selected files"
                {disabled}
                onclick={onmove}
            >
                {#snippet start()}<IconMove aria-hidden="true" />{/snippet}
                <span class="action-label">Move</span>
            </Button>
            <Button
                variant="text"
                size="s"
                aria-label="Delete selected files"
                title="Delete selected files"
                {disabled}
                loading={running === FileActionKind.Delete}
                loadingAriaLabel="Deleting selected files"
                onclick={ondelete}
            >
                {#snippet start()}<IconDelete aria-hidden="true" />{/snippet}
                <span class="action-label">Delete</span>
            </Button>
        {/if}
        <Button
            variant="text"
            size="s"
            aria-label="Details of selected files"
            title="Details of selected files"
            {disabled}
            onclick={ondetails}
        >
            {#snippet start()}<IconDetails aria-hidden="true" />{/snippet}
            <span class="action-label">Details</span>
        </Button>
    </div>
    <IconButton
        size="s"
        title="Clear selection"
        aria-label="Clear selection"
        {disabled}
        onclick={onclear}
    >
        <IconClose aria-hidden="true" />
    </IconButton>
</div>

<style>
    .selection-bar {
        position: fixed;
        z-index: 21;
        left: 50%;
        bottom: 24px;
        display: flex;
        align-items: center;
        gap: 4px;
        max-width: calc(100vw - 32px);
        padding: 8px 8px 8px 16px;
        transform: translateX(-50%);
        border: 1px solid var(--app-border-strong);
        border-radius: 16px;
        background: var(--np-color-surface-container-high);
        box-shadow: 0 10px 24px -16px color-mix(in srgb, black 45%, transparent);
        color: var(--app-text);
    }

    .count {
        margin-inline-end: 8px;
        font-size: 14px;
        font-variant-numeric: tabular-nums;
        font-weight: 500;
        white-space: nowrap;
    }

    .actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .selection-bar :global(.np-button) {
        --np-button-padding: 8px;
        --np-button-gap: 8px;
        --np-text-button-label-text-color: var(--app-text);
        white-space: nowrap;
    }

    @media (width > 800px) {
        .selection-bar {
            left: calc(50% + 120px);
        }
    }

    @media (width < 800px) {
        .selection-bar {
            right: 8px;
            left: 8px;
            bottom: calc(88px + env(safe-area-inset-bottom, 0px));
            max-width: none;
            overflow-x: auto;
            padding-inline: 12px;
            transform: none;
        }
    }

    @media (width < 560px) {
        .action-label {
            display: none;
        }
    }
</style>
