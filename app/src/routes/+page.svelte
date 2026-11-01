<script lang="ts">
    import { AppView, ConfirmKind, FileActionKind } from '@madkarmaa/phodrive-core/models';
    import type { FileGroup, FolderEntry } from '@madkarmaa/phodrive-core/files';

    import { onMount, untrack } from 'svelte';
    import type { PageData } from './$types';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import { DriveController } from '#browser/drive/index.svelte';
    import { createDriveManage } from '#browser/drive/manage-factory';
    import type { MenuAnchor } from '#browser/drive/menu-types';
    import AppHeader from '#components/AppHeader.svelte';
    import AccountMenu from '#components/AccountMenu.svelte';
    import AccountSetup from '#components/AccountSetup.svelte';
    import ConfirmDialog from '#components/ConfirmDialog.svelte';
    import ManageLayer from '#components/ManageLayer.svelte';
    import UploadSidebar from '#components/UploadSidebar.svelte';
    import UploadPanel from '#components/UploadPanel.svelte';
    import FilesView from '#components/FilesView.svelte';
    import SettingsView from '#components/SettingsView.svelte';
    import TrashView from '#components/TrashView.svelte';
    import ErrorFeedback from '#components/ErrorFeedback.svelte';
    import FileDrop from '#components/FileDrop.svelte';
    import { libraryStats } from '@madkarmaa/phodrive-core/stats';

    interface Props {
        data: PageData;
    }

    let { data }: Props = $props();

    const drive = new DriveController(untrack(() => data.preferencesDefaults));
    const manage = createDriveManage(drive);
    const actionsDisabled = $derived(drive.busy || !!drive.fileAction || manage.busy);
    const stats = $derived(libraryStats(drive.library.files));
    let view = $state<AppView>(AppView.Files);
    let navigationOpen = $state(false);
    let accountButton = $state<HTMLElement>();

    onMount(() => drive.initialize());

    function addAccount() {
        view = AppView.Files;
        drive.accountEditor.adding = true;
        drive.feedbackMessage = '';
    }

    function upload(files: File[]) {
        drive.accountEditor.adding = false;
        void drive.upload(files);
    }

    function download(item: FileGroup) {
        void drive.actOnFile(item, FileActionKind.Download);
    }

    function restore(item: FileGroup) {
        void drive.actOnFile(item, FileActionKind.Restore);
    }

    function confirmTrash(item: FileGroup) {
        drive.confirmTarget = { kind: ConfirmKind.File, item };
        drive.confirmOpen = true;
    }

    function confirmPermanentDelete(item: FileGroup) {
        drive.confirmTarget = { kind: ConfirmKind.PermanentDelete, item };
        drive.confirmOpen = true;
    }

    function openFileMenu(item: FileGroup, anchor: MenuAnchor) {
        manage.openMenu({ kind: 'file', item }, anchor);
    }

    function openFolderMenu(folder: FolderEntry, anchor: MenuAnchor) {
        manage.openMenu({ kind: 'folder', entry: folder }, anchor);
    }
</script>

{#if !drive.ready || !drive.selectedEmail || drive.accountEditor.adding || view !== AppView.Files}
    <FileDrop disabled={true} onupload={upload} />
{/if}

<div
    class="grid min-h-screen grid-cols-[256px_minmax(0,1fr)] grid-rows-[64px_minmax(calc(100vh-64px),auto)] max-[800px]:grid-cols-1 max-[800px]:grid-rows-[72px_minmax(calc(100vh-72px),auto)]"
>
    <ConfirmDialog
        bind:open={drive.confirmOpen}
        target={drive.confirmTarget}
        onconfirm={() => drive.confirmAction()}
    />

    <ManageLayer
        {manage}
        {actionsDisabled}
        ondownload={download}
        onrestore={restore}
        ondelete={confirmTrash}
        ondeleteforever={confirmPermanentDelete}
        onopenfolder={(path) => drive.library.openFolder(path)}
    />

    <AppHeader
        bind:search={drive.library.searchTerm}
        email={drive.selectedEmail}
        theme={drive.settings.themeMode}
        menuOpen={drive.accountMenuOpen}
        {navigationOpen}
        onnavigation={() => (navigationOpen = true)}
        refreshing={drive.library.loading}
        refreshDisabled={!drive.selectedEmail || actionsDisabled || drive.library.loading}
        onrefresh={() => {
            void drive.library.refresh(true);
        }}
        ontheme={(mode) => drive.settings.chooseTheme(mode)}
        searchDisabled={view !== AppView.Files}
        bind:accountButton
    />

    <ErrorFeedback bind:message={drive.feedbackMessage} />

    <AccountMenu
        bind:open={drive.accountMenuOpen}
        anchor={accountButton}
        emails={Object.keys(drive.accounts)}
        selected={drive.selectedEmail}
        disabled={actionsDisabled}
        onselect={(email) => drive.selectAccount(email)}
        onadd={addAccount}
        onsignout={() => {
            drive.confirmTarget = { kind: ConfirmKind.Account, email: drive.selectedEmail };
            drive.confirmOpen = true;
        }}
    />

    <UploadSidebar
        bind:open={navigationOpen}
        connected={!!drive.selectedEmail}
        disabled={actionsDisabled || drive.library.loading}
        {view}
        {stats}
        statsPartial={!!drive.library.nextPageToken || drive.library.partial}
        groups={drive.groupSettings.groups}
        uploadTarget={drive.groupMode.uploadTarget}
        currentEmail={drive.selectedEmail}
        unavailableTarget={drive.groupMode.unavailableTargetName}
        onnavigate={(nextView) => (view = nextView)}
        onuploadtarget={(id) => drive.groupMode.choose(id)}
        onconnect={addAccount}
        onupload={upload}
    />

    <main
        class="mr-4 mb-4 flex min-w-0 flex-col rounded-[20px] bg-panel px-6 pt-6 pb-12 text-text max-[800px]:mx-2 max-[800px]:mb-2 max-[800px]:px-4 max-[800px]:pt-4 max-[800px]:pb-[calc(96px+env(safe-area-inset-bottom,0px))]"
    >
        {#if drive.ready && view === AppView.Settings}
            <SettingsView {drive} defaults={data.preferencesDefaults} />
        {:else if drive.ready && view === AppView.Trash && drive.selectedEmail}
            <TrashView
                files={drive.library.trashFiles}
                bind:sort={drive.settings.fileSort}
                disabled={actionsDisabled || drive.library.loading}
                loading={drive.library.loading}
                loadFailed={drive.library.loadFailed}
                hasMore={!!drive.library.nextPageToken}
                showOwner={drive.groupMode.target !== null}
                groupName={drive.groupMode.target?.group.name}
                total={drive.groupMode.target?.group.accounts.length ?? 0}
                accounts={drive.library.accounts}
                partial={drive.library.partial}
                onmenu={openFileMenu}
                onmore={() => {
                    void drive.library.load(false);
                }}
            />
        {:else if drive.ready && (!drive.selectedEmail || drive.accountEditor.adding)}
            <div in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
                <div class="workspace-heading">
                    <h1>
                        {drive.accountEditor.adding && drive.selectedEmail
                            ? 'Add account'
                            : 'Connect your account'}
                    </h1>
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
        {:else if drive.ready}
            <FilesView
                {drive}
                {actionsDisabled}
                onupload={upload}
                onfilemenu={openFileMenu}
                onfoldermenu={openFolderMenu}
            />
        {/if}
    </main>
</div>

<UploadPanel
    bind:open={drive.uploadPanelOpen}
    busy={drive.busy}
    jobs={drive.uploadJobs}
    retryDisabled={actionsDisabled || drive.library.loading || !drive.selectedEmail}
    onretry={(id) => {
        void drive.retryUpload(id);
    }}
/>
