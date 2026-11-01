<script lang="ts">
    import type { Snippet } from 'svelte';
    import { onDestroy } from 'svelte';
    import { intersects, marqueeRect, type MarqueeRect } from '#lib/marquee';

    interface Props {
        selected: ReadonlySet<string>;
        disabled?: boolean;
        onpreview: (keys: ReadonlySet<string>) => void;
        class?: string;
        children: Snippet;
    }

    let {
        selected,
        disabled = false,
        onpreview,
        class: className = '',
        children
    }: Props = $props();
    const DRAG_THRESHOLD = 4;
    const IGNORE = [
        'tr',
        'li',
        'input',
        'button',
        'a',
        'select',
        'textarea',
        'label',
        'th',
        'thead',
        '[role="button"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[contenteditable="true"]',
        '[data-file-key]'
    ].join(',');

    let surface = $state<HTMLElement>();
    let rectangle = $state<MarqueeRect | null>(null);
    let drag = $state<{
        pointerId: number;
        startX: number;
        startY: number;
        additive: boolean;
        previous: Set<string>;
        moved: boolean;
    } | null>(null);

    function ignored(target: EventTarget | null): boolean {
        return target instanceof Element && target.closest(IGNORE) !== null;
    }

    function start(event: PointerEvent): void {
        if (disabled || event.pointerType === 'touch' || event.button !== 0) return;
        if (ignored(event.target)) return;

        drag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            additive: event.ctrlKey || event.metaKey,
            previous: new Set(selected),
            moved: false
        };
        surface?.setPointerCapture(event.pointerId);
    }

    function move(event: PointerEvent): void {
        if (!drag || event.pointerId !== drag.pointerId) return;

        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;

        if (!drag.moved) {
            drag.moved = true;
            window.addEventListener('keydown', keydown, true);
        }

        event.preventDefault();
        const next = marqueeRect(drag.startX, drag.startY, event.clientX, event.clientY);
        rectangle = next;
        const hits = new Set<string>();
        for (const element of surface?.querySelectorAll<HTMLElement>('[data-file-key]') ?? []) {
            const box = element.getBoundingClientRect();
            if (
                intersects(next, {
                    left: box.left,
                    top: box.top,
                    right: box.right,
                    bottom: box.bottom
                })
            ) {
                const key = element.dataset.fileKey;
                if (key) hits.add(key);
            }
        }

        const keys = drag.additive ? new Set([...drag.previous, ...hits]) : hits;
        onpreview(keys);
    }

    function end(event: PointerEvent): void {
        if (!drag || event.pointerId !== drag.pointerId) return;

        finish();
    }

    function cancel(): void {
        if (!drag) return;

        if (drag.moved) onpreview(drag.previous);
        finish();
    }

    function finish(): void {
        const current = drag;
        drag = null;
        rectangle = null;
        if (surface && current) surface.releasePointerCapture?.(current.pointerId);
        if (current?.moved) window.removeEventListener('keydown', keydown, true);
    }

    function keydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return;

        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
    }

    onDestroy(() => {
        window.removeEventListener('keydown', keydown, true);
    });
</script>

<div
    class={`marquee-surface ${className}`}
    class:dragging={drag?.moved}
    role="group"
    bind:this={surface}
    onpointerdown={start}
    onpointermove={move}
    onpointerup={end}
    onpointercancel={() => cancel()}
    onlostpointercapture={() => cancel()}
>
    {@render children()}
    {#if rectangle}
        <div
            class="marquee-rect"
            aria-hidden="true"
            style:left={`${rectangle.left}px`}
            style:top={`${rectangle.top}px`}
            style:width={`${rectangle.right - rectangle.left}px`}
            style:height={`${rectangle.bottom - rectangle.top}px`}
        ></div>
    {/if}
</div>

<style>
    .marquee-surface {
        min-width: 0;
        min-height: 0;
    }

    .marquee-surface.dragging {
        user-select: none;
    }

    .marquee-rect {
        position: fixed;
        z-index: 15;
        border: 1.5px solid var(--app-primary);
        border-radius: 4px;
        background: color-mix(in srgb, var(--app-primary) 10%, transparent);
        pointer-events: none;
    }
</style>
