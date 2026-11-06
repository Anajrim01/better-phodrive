<script lang="ts" module>
    import { MediaQuery } from 'svelte/reactivity';

    const smallScreen = new MediaQuery('(width < 800px)');
</script>

<script lang="ts">
    import type { Component } from 'svelte';
    import { Button, IconButton, Menu, MenuItem } from 'noph-ui';
    import { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import IconDownload from '~icons/material-symbols/download';
    import IconShare from '~icons/material-symbols/share';
    import IconDelete from '~icons/material-symbols/delete-outline';
    import IconRestore from '~icons/material-symbols/restore-from-trash';
    import IconDeleteForever from '~icons/material-symbols/delete-forever';
    import IconMore from '~icons/material-symbols/more-vert';

    interface Props {
        item: FileGroup;
        disabled: boolean;
        working: FileActionKind | null;
        compact?: boolean;
        trash?: boolean;
        ondownload?: (item: FileGroup) => void;
        onshare?: (item: FileGroup) => void;
        ondelete?: (item: FileGroup) => void;
        onrestore?: (item: FileGroup) => void;
        ondeleteforever?: (item: FileGroup) => void;
    }

    type Action = {
        label: string;
        title: string;
        icon: Component;
        disabled: boolean;
        kind?: FileActionKind;
        loadingLabel?: string;
        run: () => void;
    };

    let {
        item,
        disabled,
        working,
        compact = false,
        trash = false,
        ondownload,
        onshare,
        ondelete,
        onrestore,
        ondeleteforever
    }: Props = $props();

    let moreButton = $state<HTMLButtonElement | HTMLAnchorElement>();
    let menu = $state<ReturnType<typeof Menu>>();
    let menuElement = $state<HTMLDivElement>();
    let menuOpen = $state(false);
    const uid = $props.id();
    const anchorName = `--file-actions-${uid}`;

    const actions = $derived.by(() => {
        const available: Action[] = [];

        if (trash) {
            if (onrestore)
                available.push({
                    label: 'Restore',
                    title: `Restore ${item.name}`,
                    icon: IconRestore,
                    disabled,
                    kind: FileActionKind.Restore,
                    loadingLabel: `Restoring ${item.name}`,
                    run: () => onrestore(item)
                });
            if (ondeleteforever)
                available.push({
                    label: 'Delete forever',
                    title: `Delete forever: ${item.name}`,
                    icon: IconDeleteForever,
                    disabled,
                    kind: FileActionKind.DeleteForever,
                    loadingLabel: `Deleting ${item.name} forever`,
                    run: () => ondeleteforever(item)
                });

            return available;
        }

        if (ondownload)
            available.push({
                label: 'Download',
                title: `Download ${item.name}`,
                icon: IconDownload,
                disabled: disabled || !item.complete,
                kind: FileActionKind.Download,
                loadingLabel: `Downloading ${item.name}`,
                run: () => ondownload(item)
            });
        if (onshare)
            available.push({
                label: 'Share',
                title: `Share ${item.name}`,
                icon: IconShare,
                disabled:
                    disabled || !item.complete || item.trashed || !!item.trashedChunks?.length,
                run: () => onshare(item)
            });
        if (ondelete)
            available.push({
                label: 'Delete',
                title: `Delete ${item.name}`,
                icon: IconDelete,
                disabled,
                kind: FileActionKind.Delete,
                loadingLabel: `Deleting ${item.name}`,
                run: () => ondelete(item)
            });

        return available;
    });
    const runningAction = $derived(actions.find((action) => action.kind === working));

    function choose(action: Action) {
        // Noph keeps onclick on a disabled menu item.
        if (action.disabled) return;

        menu?.close();
        moreButton?.focus();
        action.run();
    }
</script>

<div class="file-actions flex shrink-0 flex-wrap items-center justify-end">
    {#if !compact && !trash}
        {#each actions as action (action.label)}
            <Button
                variant="text"
                size="xs"
                disabled={action.disabled}
                loading={!!action.kind && action.kind === working}
                loadingAriaLabel={action.loadingLabel}
                onclick={action.run}
            >
                {#snippet start()}<action.icon aria-hidden="true" />{/snippet}
                {action.label}
            </Button>
        {/each}
    {:else if smallScreen.current}
        <IconButton
            bind:element={moreButton}
            style={`anchor-name: ${anchorName}`}
            size="xs"
            title={`More actions for ${item.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            loading={!!runningAction}
            loadingAriaLabel={runningAction?.loadingLabel}
            onclick={() => menu?.show()}
        >
            <IconMore aria-hidden="true" />
        </IconButton>
        <Menu
            anchor={moreButton}
            style={`position-anchor: ${anchorName}`}
            class="file-actions-menu"
            bind:this={menu}
            bind:element={menuElement}
            bind:open={menuOpen}
            coverAnchor={false}
            aria-label={`Actions for ${item.name}`}
            ontoggle={(event) => {
                if (event.newState === 'open')
                    menuElement?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
                else if (menuElement?.contains(document.activeElement)) moreButton?.focus();
            }}
        >
            {#each actions as action (action.label)}
                <MenuItem disabled={action.disabled} onclick={() => choose(action)}>
                    {#snippet start()}<action.icon aria-hidden="true" class="size-5" />{/snippet}
                    {action.label}
                </MenuItem>
            {/each}
        </Menu>
    {:else}
        {#each actions as action (action.label)}
            <IconButton
                size="xs"
                title={action.title}
                disabled={action.disabled}
                loading={!!action.kind && action.kind === working}
                loadingAriaLabel={action.loadingLabel}
                onclick={action.run}><action.icon aria-hidden="true" /></IconButton
            >
        {/each}
    {/if}
</div>

<style>
    :global(.file-actions-menu) {
        --np-menu-position-area: bottom span-left;
        --np-menu-justify-self: end;
        --np-menu-container-color: var(--app-panel);
        --np-menu-container-shape: 8px;
    }

    .file-actions :global(.np-button) {
        font-size: 12px;
        --np-button-padding: 7px;
        --np-button-gap: 4px;
        --np-button-icon-size: 16px;
    }
</style>
