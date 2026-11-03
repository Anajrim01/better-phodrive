<script lang="ts">
    import { onMount } from 'svelte';
    import type { DriveShares } from '#browser/drive/shares.svelte';
    import RevokeShareDialog from '#components/RevokeShareDialog.svelte';
    import ShareCreateDialog from '#components/ShareCreateDialog.svelte';

    interface Props {
        shares: DriveShares;
    }

    let { shares }: Props = $props();

    onMount(() => {
        void shares.checkAvailability();
    });
</script>

<ShareCreateDialog
    bind:open={shares.createOpen}
    files={shares.createFiles}
    invalidReason={shares.createInvalid}
    busy={shares.createBusy}
    error={shares.createError}
    errorCode={shares.createErrorCode}
    recovery={shares.createRecovery}
    record={shares.created}
    storageNotice={shares.storageNotice}
    copyState={shares.copyState}
    copyError={shares.copyError}
    oncreate={(name) => {
        void shares.create(name);
    }}
    oncopy={(record) => {
        void shares.copy(record);
    }}
    onclose={() => shares.closeCreate()}
/>

<RevokeShareDialog
    bind:open={shares.revokeOpen}
    record={shares.revokeTarget}
    busy={shares.revokeBusy}
    error={shares.revokeError}
    errorCode={shares.revokeErrorCode}
    recovery={shares.revokeRecovery}
    onrevoke={() => {
        void shares.revoke();
    }}
    onclose={() => shares.closeRevoke()}
/>
