<script lang="ts">
    import {
        ExtendedFab,
        Fab,
        Button,
        IconButton,
        NavigationDrawer,
        NavigationDrawerItem
    } from 'noph-ui';
    import { MediaQuery } from 'svelte/reactivity';
    import { AppView } from '@madkarmaa/phodrive-core/models';
    import type { Group } from '@madkarmaa/phodrive-core/models';
    import type { LibraryStats } from '@madkarmaa/phodrive-core/stats';
    import StorageSummary from '#components/StorageSummary.svelte';
    import UploadTarget from '#components/UploadTarget.svelte';
    import IconAdd from '~icons/material-symbols/add';
    import IconHome from '~icons/material-symbols/home-outline';
    import IconSettings from '~icons/material-symbols/settings-outline';
    import IconFolder from '~icons/material-symbols/folder-open-outline';
    import IconClose from '~icons/material-symbols/close';

    interface Props {
        open?: boolean;
        connected: boolean;
        disabled: boolean;
        view: AppView;
        stats: LibraryStats;
        statsPartial: boolean;
        groups: readonly Group[];
        uploadTarget: string;
        currentEmail: string;
        unavailableTarget?: string | null;
        onnavigate: (view: AppView) => void;
        onupload: (files: File[]) => void;
        onuploadtarget: (id: string) => void;
        onconnect: () => void;
    }

    let {
        open = $bindable(false),
        connected,
        disabled,
        view,
        stats,
        statsPartial,
        groups,
        uploadTarget,
        currentEmail,
        unavailableTarget = null,
        onnavigate,
        onupload,
        onuploadtarget,
        onconnect
    }: Props = $props();

    let picker: HTMLInputElement;
    let folderPicker: HTMLInputElement;
    const mobile = new MediaQuery('(width < 800px)');

    $effect(() => {
        if (!mobile.current) open = false;
    });

    function selectedFiles(input: HTMLInputElement): File[] {
        const files = Array.from(input.files ?? []);
        input.value = '';

        return files;
    }

    function navigate(nextView: AppView) {
        open = false;
        onnavigate(nextView);
    }
</script>

<aside class="upload-sidebar min-w-0 px-4 pt-2 pb-8" aria-label="Navigation and accounts">
    <UploadTarget
        {groups}
        value={uploadTarget}
        {currentEmail}
        unavailable={unavailableTarget}
        onchange={onuploadtarget}
    />

    <ExtendedFab
        class="upload-button"
        label="Upload"
        aria-label="Upload"
        variant="secondary-container"
        {disabled}
        onclick={() => (connected ? picker.click() : onconnect())}
    >
        {#snippet icon()}<IconAdd aria-hidden="true" class="size-5" />{/snippet}
    </ExtendedFab>

    <input
        bind:this={picker}
        type="file"
        multiple
        class="sr-only"
        aria-label="Upload files"
        onchange={(event) => {
            const files = selectedFiles(event.currentTarget);

            if (!files.length) return;

            onupload(files);
        }}
    />

    <input
        bind:this={folderPicker}
        type="file"
        multiple
        webkitdirectory
        class="sr-only"
        aria-label="Upload folder"
        onchange={(event) => {
            const files = selectedFiles(event.currentTarget);

            if (!files.length) return;

            onupload(files);
        }}
    />

    <div class="folder-upload">
        <Button
            variant="text"
            {disabled}
            onclick={() => (connected ? folderPicker.click() : onconnect())}
        >
            {#snippet start()}<IconFolder aria-hidden="true" class="size-5" />{/snippet}
            Upload folder
        </Button>
    </div>

    <NavigationDrawer
        id="main-navigation"
        class={mobile.current ? 'mobile-navigation' : 'drive-navigation'}
        aria-label="Main"
        modal={mobile.current}
        backdrop
        bind:open
    >
        {#if mobile.current}
            <div class="mb-4 flex items-center justify-between gap-4 pl-4">
                <span class="text-xl text-text">Phodrive</span>
                <IconButton title="Close navigation" onclick={() => (open = false)}>
                    <IconClose aria-hidden="true" />
                </IconButton>
            </div>
        {/if}
        <NavigationDrawerItem
            label="My files"
            aria-label="My files"
            selected={view === AppView.Files}
            aria-current={view === AppView.Files ? 'page' : undefined}
            onclick={() => navigate(AppView.Files)}
        >
            {#snippet icon()}<IconHome aria-hidden="true" class="size-5 shrink-0" />{/snippet}
        </NavigationDrawerItem>
        <NavigationDrawerItem
            label="Settings"
            aria-label="Settings"
            selected={view === AppView.Settings}
            aria-current={view === AppView.Settings ? 'page' : undefined}
            onclick={() => navigate(AppView.Settings)}
        >
            {#snippet icon()}<IconSettings aria-hidden="true" class="size-5 shrink-0" />{/snippet}
        </NavigationDrawerItem>

        {#if connected}
            <StorageSummary {stats} hasMore={statsPartial} />
        {/if}
    </NavigationDrawer>

    <div class="mobile-upload">
        <Fab
            class="upload-fab"
            label="Upload"
            variant="secondary-container"
            shape="square"
            {disabled}
            onclick={() => (connected ? picker.click() : onconnect())}
        >
            {#snippet icon()}<IconAdd aria-hidden="true" class="size-5" />{/snippet}
        </Fab>
    </div>
</aside>

<style>
    .mobile-upload {
        display: none;
    }

    .folder-upload {
        margin-bottom: 16px;
    }

    .folder-upload :global(.np-button) {
        --np-button-padding: 16px;
        --np-button-gap: 12px;
        --np-text-button-label-text-color: var(--app-muted);
    }

    :global(.mobile-navigation) {
        --np-navigation-drawer-width: min(320px, calc(100vw - 56px));
        --np-navigation-drawer-padding: max(16px, env(safe-area-inset-top, 0px)) 16px 24px;
        --np-color-secondary-container: var(--app-selected);
        --np-color-on-secondary-container: var(--app-selected-text);
        --np-navigation-drawer-item-container-shape: 8px;
    }

    :global(.mobile-navigation .np-navigation-drawer-item) {
        height: 48px;
        padding: 0 16px;
        gap: 12px;
    }

    :global(:root .upload-fab.np-fab) {
        --np-fab-container-color: var(--app-panel);
        --np-fab-icon-color: var(--app-text);
        --np-fab-shape: 16px;
        --np-fab-elevation: inset 0 0 0 1px var(--app-border-strong);
        --np-icon-size: 20px;
    }

    :global(:root .upload-button.np-extended-fab:disabled),
    :global(:root .upload-fab.np-fab:disabled) {
        box-shadow: inset 0 0 0 1px var(--app-border-strong);
    }

    :global(:root .upload-button.np-extended-fab) {
        height: 56px;
        min-width: 110px;
        margin-bottom: 8px;
        --np-fab-container-color: var(--app-panel);
        --np-fab-icon-color: var(--app-text);
        --np-fab-shape: 16px;
        --np-fab-elevation: inset 0 0 0 1px var(--app-border-strong);
        --np-icon-size: 20px;
    }

    :global(:root .drive-navigation.np-navigation-drawer-container) {
        width: 100%;
        --np-navigation-drawer-width: 100%;
        --np-navigation-drawer-height: auto;
        --np-navigation-drawer-padding: 0;
        --np-navigation-drawer-background: transparent;
        --np-color-secondary-container: var(--app-selected);
        --np-color-on-secondary-container: var(--app-selected-text);
        --np-navigation-drawer-item-container-shape: 8px;
    }

    :global(:root .drive-navigation.np-navigation-drawer-container .np-navigation-drawer) {
        gap: 4px;
    }
    :global(:root .drive-navigation.np-navigation-drawer-container .np-navigation-drawer-item) {
        height: 40px;
        width: 100%;
        padding: 0 16px;
        gap: 12px;
    }

    @media (width <= 800px), (hover: none), (pointer: coarse) {
        .folder-upload {
            display: none;
        }
    }

    @media (width < 800px) {
        .upload-sidebar {
            display: contents;
        }

        :global(:root .upload-button.np-extended-fab) {
            display: none;
        }

        .mobile-upload {
            display: block;
            position: fixed;
            right: calc(16px + env(safe-area-inset-right, 0px));
            bottom: calc(16px + env(safe-area-inset-bottom, 0px));
            z-index: 20;
        }
    }
</style>
