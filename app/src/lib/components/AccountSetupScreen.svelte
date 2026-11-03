<script lang="ts">
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { DriveController } from '#browser/drive/index.svelte';
    import AccountSetup from '#components/AccountSetup.svelte';

    interface Props {
        drive: DriveController;
    }

    let { drive }: Props = $props();
</script>

<div in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
    <div class="workspace-heading">
        <h1>Connect to Google Photos</h1>
    </div>
    <AccountSetup
        bind:email={drive.accountEditor.newEmail}
        bind:token={drive.accountEditor.newToken}
        connecting={drive.accountEditor.connecting}
        canCancel={!!drive.selectedEmail}
        onsave={() => {
            void drive.saveAccount();
        }}
        oncancel={() => {
            drive.accountEditor.adding = false;
            drive.feedbackMessage = '';
        }}
    />
</div>
