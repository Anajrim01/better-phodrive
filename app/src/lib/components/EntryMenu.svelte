<script lang="ts">
    import { tick, type Component } from 'svelte';
    import { Divider, Menu, MenuItem } from 'noph-ui';
    import type { MenuAction } from '#lib/menus';
    import { fileMenu, folderMenu, selectionMenu } from '#lib/menus';
    import { clampMenuPosition } from '#lib/menu-position';
    import {
        isPoint,
        type MenuAnchor,
        type MenuPoint,
        type MenuTarget
    } from '#browser/drive/menu-types';
    import IconPreview from '~icons/material-symbols/visibility';
    import IconDownload from '~icons/material-symbols/download';
    import IconRename from '~icons/material-symbols/drive-file-rename-outline';
    import IconMove from '~icons/material-symbols/drive-file-move-outline';
    import IconRestore from '~icons/material-symbols/restore-from-trash';
    import IconDelete from '~icons/material-symbols/delete-outline';
    import IconDeleteForever from '~icons/material-symbols/delete-forever-outline';
    import IconDetails from '~icons/material-symbols/info';
    import IconOpen from '~icons/material-symbols/folder-open-outline';

    const MENU_ICONS: Partial<Record<MenuAction, Component>> = {
        preview: IconPreview,
        download: IconDownload,
        rename: IconRename,
        move: IconMove,
        'move-contents': IconMove,
        restore: IconRestore,
        delete: IconDelete,
        'delete-folder': IconDelete,
        'delete-forever': IconDeleteForever,
        open: IconOpen
    };

    interface Props {
        open: boolean;
        target: MenuTarget | null;
        anchor: MenuAnchor | null;
        disabled?: boolean;
        onclose: () => void;
        onaction: (action: MenuAction) => void;
    }

    let { open, target, anchor, disabled = false, onclose, onaction }: Props = $props();

    let menu = $state<ReturnType<typeof Menu>>();
    let menuElement = $state<HTMLDivElement>();
    let anchorElement = $state<HTMLElement>();
    let returnFocus = $state<HTMLElement | null>(null);
    let wasOpen = false;
    let suppressFocus = false;

    const entries = $derived(
        target === null
            ? []
            : target.kind === 'selection'
              ? selectionMenu(target.trash)
              : target.kind === 'file'
                ? fileMenu(target.item, target.item.trashed)
                : folderMenu(target.entry)
    );

    function anchorPoint(): MenuPoint | null {
        if (!anchor) return null;
        if (isPoint(anchor)) return anchor;

        const rect = anchor.getBoundingClientRect();

        return { x: rect.left, y: rect.bottom + 2 };
    }

    function placeMenu(): void {
        const point = anchorPoint();
        if (!point || !menuElement || !menuElement.isConnected) return;

        if (anchorElement?.isConnected) {
            anchorElement.style.left = `${point.x}px`;
            anchorElement.style.top = `${point.y}px`;
        }

        const rect = menuElement.getBoundingClientRect();
        const placement = clampMenuPosition({
            x: point.x,
            y: point.y,
            width: rect.width,
            height: rect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
        });
        menuElement.style.position = 'fixed';
        menuElement.style.setProperty('position-area', 'none');
        menuElement.style.setProperty('left', `${placement.left}px`);
        menuElement.style.setProperty('top', `${placement.top}px`);
        menuElement.style.setProperty('max-height', `${placement.maxHeight}px`);
        menuElement.style.setProperty('margin', '0');
    }

    async function showMenu(): Promise<void> {
        if (!menuElement || !menu) return;

        menuElement.style.visibility = 'hidden';
        menu.show();
        await tick();
        if (!menuElement || !menuElement.isConnected) return;

        placeMenu();
        menuElement.style.visibility = 'visible';
        menuElement.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }

    function requestClose(): void {
        menu?.close();
        onclose();
    }

    function choose(action: MenuAction): void {
        suppressFocus = true;
        requestClose();
        onaction(action);
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (!open) return;
        if (event.key !== 'Escape') {
            handleMenuKeydown(event);

            return;
        }

        event.preventDefault();
        requestClose();
    }

    function handleMenuKeydown(event: KeyboardEvent): void {
        if (!menuElement || event.defaultPrevented) return;

        const items = [...menuElement.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
            (item) => !item.matches(':disabled')
        );
        if (items.length === 0) return;

        const active = document.activeElement;
        const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
        let target: HTMLElement | undefined;
        if (event.key === 'ArrowDown') target = items[(index + 1 + items.length) % items.length];
        else if (event.key === 'ArrowUp') target = items[(index - 1 + items.length) % items.length];
        else if (event.key === 'Home') target = items[0];
        else if (event.key === 'End') target = items.at(-1);
        if (!target) return;

        event.preventDefault();
        target.focus();
    }

    function handlePointerDown(event: PointerEvent): void {
        if (!menuElement || (event.target instanceof Node && menuElement.contains(event.target)))
            return;

        requestClose();
    }

    $effect(() => {
        if (open && !wasOpen) {
            wasOpen = true;
            returnFocus =
                anchor && !isPoint(anchor)
                    ? anchor
                    : document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
            void showMenu();
        } else if (!open && wasOpen) {
            wasOpen = false;
            menu?.close();
            const focus = returnFocus;
            returnFocus = null;
            if (!suppressFocus && focus?.isConnected) focus.focus();
            suppressFocus = false;
        }
    });

    $effect(() => {
        const element = menuElement;
        if (!open || !element) return;

        const handler = (event: Event) => handleMenuKeydown(event as KeyboardEvent);
        element.addEventListener('keydown', handler);

        return () => element.removeEventListener('keydown', handler);
    });

    $effect(() => {
        if (!open) return;

        const close = () => requestClose();
        window.addEventListener('scroll', close, { capture: true, passive: true });
        window.addEventListener('resize', close);
        window.addEventListener('keydown', handleKeydown);
        document.addEventListener('pointerdown', handlePointerDown, true);

        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
            window.removeEventListener('keydown', handleKeydown);
            document.removeEventListener('pointerdown', handlePointerDown, true);
        };
    });
</script>

<span
    bind:this={anchorElement}
    class="menu-anchor"
    aria-hidden="true"
    style="anchor-name: --phodrive-context-menu"
></span>

<Menu
    bind:this={menu}
    bind:element={menuElement}
    anchor={anchorElement}
    role="menu"
    aria-label="Actions"
    class="entry-menu"
    style="position-anchor: --phodrive-context-menu; --np-menu-justify-self: start; --np-menu-position-area: bottom;"
    onkeydown={handleMenuKeydown}
    ontoggle={(event) => {
        if (event.newState === 'closed') onclose();
    }}
>
    {#each entries as entry (entry.action)}
        {@const Icon = MENU_ICONS[entry.action] ?? IconDetails}
        {#if entry.divider}<Divider />{/if}
        <MenuItem {disabled} onclick={() => choose(entry.action)}>
            {#snippet start()}<Icon aria-hidden="true" />{/snippet}
            {entry.label}
        </MenuItem>
    {/each}
</Menu>

<style>
    .menu-anchor {
        position: fixed;
        width: 0;
        height: 0;
        pointer-events: none;
    }

    :global(:root .entry-menu.np-menu-container[popover]) {
        min-width: 13rem;
        max-width: min(20rem, calc(100vw - 16px));
        visibility: hidden;
    }

    :global(:root .entry-menu.np-menu-container:popover-open) {
        visibility: visible;
    }
</style>
