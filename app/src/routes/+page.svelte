<script lang="ts">
    import { AppView, ConfirmKind, FileActionKind } from '@madkarmaa/phodrive-core/models';

    import { onMount, untrack } from 'svelte';
    import type { PageData } from './$types';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import { DriveController } from '#browser/drive/index.svelte';
    import AppHeader from '#components/AppHeader.svelte';
    import AccountMenu from '#components/AccountMenu.svelte';
    import AccountSetup from '#components/AccountSetup.svelte';
    import ConfirmDialog from '#components/ConfirmDialog.svelte';
    import UploadSidebar from '#components/UploadSidebar.svelte';
    import UploadPanel from '#components/UploadPanel.svelte';
    import FileFilters from '#components/FileFilters.svelte';
    import FileGrid from '#components/FileGrid.svelte';
    import LayoutToggle from '#components/LayoutToggle.svelte';
    import SettingsPanel from '#components/SettingsPanel.svelte';
    import ErrorFeedback from '#components/ErrorFeedback.svelte';
    import FileDrop from '#components/FileDrop.svelte';
    import { libraryStats } from '@madkarmaa/phodrive-core/stats';

    interface Props {
        data: PageData;
    }

    let { data }: Props = $props();

    const drive = new DriveController(untrack(() => data.preferencesDefaults));
    const actionsDisabled = $derived(drive.busy || !!drive.fileAction);
    const stats = $derived(libraryStats(drive.library.files));
    let view = $state<AppView>(AppView.Files);
    let navigationOpen = $state(false);
    let accountButton = $state<HTMLElement>();

    onMount(() => drive.initialize());

    function addAccount() {
        view = AppView.Files;
        drive.adding = true;
        drive.feedbackMessage = '';
    }

    function upload(files: File[]) {
        drive.adding = false;
        void drive.upload(files);
    }
</script>

{#if !drive.ready || !drive.selectedEmail || drive.adding || view !== AppView.Files}
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
        statsPartial={!!drive.library.nextPageToken}
        onnavigate={(nextView) => (view = nextView)}
        onconnect={addAccount}
        onupload={upload}
    />

    <main
        class="mr-4 mb-5 flex min-w-0 flex-col rounded-[22px] bg-panel px-7 pt-6.5 pb-12 text-text max-[800px]:mx-2 max-[800px]:mb-2 max-[800px]:px-4.5 max-[800px]:pt-5.5 max-[800px]:pb-[calc(96px+env(safe-area-inset-bottom,0px))]"
    >
        {#if drive.ready && view === AppView.Settings}
            <SettingsPanel
                defaults={data.preferencesDefaults}
                refreshIntervalSeconds={drive.settings.refreshIntervalSeconds}
                concurrentWorkers={drive.settings.concurrentWorkers}
                theme={drive.settings.themeMode}
                onrefreshinterval={(seconds) => drive.settings.chooseRefreshInterval(seconds)}
                onworkers={(workers) => drive.settings.chooseConcurrentWorkers(workers)}
                onresetrefreshinterval={() => drive.settings.resetRefreshInterval()}
                onresetworkers={() => drive.settings.resetConcurrentWorkers()}
            />
        {:else if drive.ready && (!drive.selectedEmail || drive.adding)}
            <div in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
                <div class="workspace-heading">
                    <h1>
                        {drive.adding && drive.selectedEmail
                            ? 'Add account'
                            : 'Connect your account'}
                    </h1>
                </div>
                <AccountSetup
                    bind:email={drive.newEmail}
                    bind:token={drive.newToken}
                    connecting={drive.connecting}
                    canCancel={!!drive.selectedEmail}
                    onsave={() => {
                        void drive.saveAccount();
                    }}
                    oncancel={() => {
                        drive.adding = false;
                        drive.feedbackMessage = '';
                    }}
                />
            </div>
        {:else if drive.ready}
            <div
                class="flex flex-1 flex-col"
                in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}
            >
                <div class="workspace-heading">
                    <h1 id="files-heading" class="min-w-0">
                        <span class="crumbs">
                            <button
                                type="button"
                                class="crumb"
                                class:current={!drive.library.folder}
                                aria-current={!drive.library.folder ? 'page' : undefined}
                                onclick={() => drive.library.openFolder('')}
                            >
                                My files
                            </button>
                            {#each drive.library.trail as crumb (crumb.path)}
                                <span class="crumb-separator" aria-hidden="true">/</span>
                                <button
                                    type="button"
                                    class="crumb"
                                    class:current={drive.library.folder === crumb.path}
                                    aria-current={drive.library.folder === crumb.path
                                        ? 'page'
                                        : undefined}
                                    onclick={() => drive.library.openFolder(crumb.path)}
                                >
                                    {crumb.name}
                                </button>
                            {/each}
                        </span>
                        <span class="text-subtle">({drive.library.visibleFiles.length})</span>
                    </h1>
                    <LayoutToggle bind:layout={drive.settings.fileLayout} />
                </div>

                <FileFilters
                    types={drive.library.availableTypes}
                    bind:type={drive.library.typeFilter}
                    bind:days={drive.library.modifiedDays}
                    bind:sort={drive.settings.fileSort}
                />
                <FileDrop
                    disabled={actionsDisabled ||
                        drive.library.loading ||
                        drive.confirmOpen ||
                        drive.accountMenuOpen}
                    onupload={upload}
                >
                    <FileGrid
                        files={drive.library.visibleFiles}
                        folders={drive.library.filtering ? [] : drive.library.folders}
                        layout={drive.settings.fileLayout}
                        bind:sort={drive.settings.fileSort}
                        loading={drive.library.loading}
                        loadFailed={drive.library.loadFailed}
                        filtered={drive.library.filtering}
                        hasFiles={!!drive.library.files.length}
                        hasMore={!!drive.library.nextPageToken}
                        disabled={actionsDisabled || drive.library.loading}
                        showFolder={drive.library.filtering}
                        action={drive.fileAction}
                        onopenfolder={(path) => drive.library.openFolder(path)}
                        ondownload={(item) => {
                            void drive.actOnFile(item, FileActionKind.Download);
                        }}
                        ondelete={(item) => {
                            drive.confirmTarget = { kind: ConfirmKind.File, item };
                            drive.confirmOpen = true;
                        }}
                        onmore={() => {
                            void drive.library.load(false);
                        }}
                    />
                </FileDrop>
            </div>
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

<style>
    .crumbs {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: 8px;
        row-gap: 0;
    }

    .crumb {
        max-width: 100%;
        min-width: 0;
        padding: 4px 0;
        overflow: hidden;
        border-radius: 8px;
        color: var(--app-subtle);
        font: inherit;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .crumb:hover {
        background: var(--app-hover);
        color: var(--app-text);
    }

    .crumb.current {
        color: var(--app-text);
    }

    .crumb:focus-visible {
        outline: 2px solid var(--app-primary);
        outline-offset: 2px;
    }

    .crumb-separator {
        color: var(--app-subtle);
    }
</style>
