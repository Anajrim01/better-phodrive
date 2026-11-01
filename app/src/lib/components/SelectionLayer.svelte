<script lang="ts">
    import type { DriveController } from '#browser/drive/index.svelte';
    import type { DriveSelectionView } from '#browser/drive/selection-view.svelte';
    import SelectionBar from '#components/SelectionBar.svelte';
    import SelectionKeys from '#components/SelectionKeys.svelte';
    import SelectionScope from '#components/SelectionScope.svelte';

    interface Props {
        drive: DriveController;
        selection: DriveSelectionView;
        actionsDisabled: boolean;
    }

    let { drive, selection, actionsDisabled }: Props = $props();
</script>

<SelectionScope scope={selection.scope} onreset={selection.clear} />

<SelectionKeys
    canSelectAll={selection.canSelectAll && !actionsDisabled}
    canClear={selection.count > 0 && !selection.overlayOpen}
    onselectall={() => selection.selectAll(true)}
    onclear={selection.clear}
/>

{#if selection.count > 0}
    <SelectionBar
        count={selection.count}
        trash={selection.trash}
        disabled={actionsDisabled || drive.library.loading}
        running={drive.bulk.runningAction}
        ondownload={() => void drive.bulk.download(selection.selected)}
        onmove={() => drive.bulk.openMove(selection.selected)}
        ondelete={() => selection.confirm(selection.selected, false)}
        onrestore={() => void drive.bulk.restore(selection.selected)}
        ondeleteforever={() => selection.confirm(selection.selected, true)}
        ondetails={() => drive.bulk.openDetails(selection.selected)}
        onclear={selection.clear}
    />
{/if}
