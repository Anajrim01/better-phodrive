<script lang="ts">
    import type { DriveShares } from '#browser/drive/shares.svelte';
    import SharesView from '#components/SharesView.svelte';

    interface Props {
        shares: DriveShares;
    }

    let { shares }: Props = $props();
</script>

<SharesView
    records={shares.records}
    fileCounts={shares.fileCounts}
    copyState={shares.copyState}
    copiedKey={shares.copiedKey}
    copyError={shares.copyError}
    revokeNotice={shares.revokeNotice}
    shareAvailable={shares.shareAvailable}
    oncopy={(record) => {
        void shares.copy(record);
    }}
    onrevoke={(record) => shares.openRevoke(record)}
/>
