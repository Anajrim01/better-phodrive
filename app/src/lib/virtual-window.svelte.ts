import { untrack } from 'svelte';
import {
    Virtualizer,
    defaultRangeExtractor,
    observeWindowOffset,
    observeWindowRect,
    windowScroll,
    type Range
} from '@tanstack/virtual-core';

type WindowRowsOptions<TElement extends HTMLElement> = {
    count: () => number;
    estimateSize: (index: number) => number;
    getItemKey: (index: number) => string;
    gap?: number;
    overscan?: number;
    extraIndexes?: () => readonly number[];
};

export function createWindowRows<TElement extends HTMLElement>(
    options: WindowRowsOptions<TElement>
) {
    let version = $state(0);
    let scrollMargin = $state(0);

    function setMargin(next: number) {
        if (next === scrollMargin) return;

        scrollMargin = next;
    }
    const buildRangeExtractor = () => (range: Range) => {
        const indexes = defaultRangeExtractor(range);
        for (const index of options.extraIndexes?.() ?? []) {
            if (index >= 0 && index < range.count && !indexes.includes(index)) indexes.push(index);
        }

        return indexes.sort((first, second) => first - second);
    };
    const virtualizer = new Virtualizer<Window, TElement>({
        count: options.count(),
        estimateSize: options.estimateSize,
        getItemKey: options.getItemKey,
        gap: options.gap ?? 0,
        overscan: options.overscan ?? 3,
        scrollMargin: 0,
        initialOffset: () => (typeof window === 'undefined' ? 0 : window.scrollY),
        getScrollElement: () => (typeof window === 'undefined' ? null : window),
        observeElementRect: observeWindowRect,
        observeElementOffset: observeWindowOffset,
        scrollToFn: windowScroll,
        onChange: () => {
            version += 1;
        }
    });

    if (typeof window !== 'undefined') virtualizer._willUpdate();

    $effect(() => {
        const next = {
            count: options.count(),
            estimateSize: options.estimateSize,
            getItemKey: options.getItemKey,
            gap: options.gap ?? 0,
            rangeExtractor: buildRangeExtractor(),
            scrollMargin
        };
        options.extraIndexes?.();
        untrack(() => {
            virtualizer.setOptions({ ...virtualizer.options, ...next });
            virtualizer._willUpdate();
            version += 1;
        });
    });

    $effect(() => virtualizer._didMount());

    return {
        get rows() {
            version;

            return virtualizer.getVirtualItems();
        },
        get totalSize() {
            version;

            return virtualizer.getTotalSize();
        },
        get scrollMargin() {
            return scrollMargin;
        },
        setScrollMargin: setMargin,
        scrollToRow(index: number) {
            virtualizer.scrollToIndex(index, { align: 'auto' });
        },
        trackMargin(element: () => HTMLElement | undefined) {
            $effect(() => {
                const node = element();
                if (!node) return;

                const measure = () => setMargin(node.getBoundingClientRect().top + window.scrollY);
                measure();
                const observer = new ResizeObserver(measure);
                observer.observe(document.body);
                window.addEventListener('resize', measure);

                return () => {
                    observer.disconnect();
                    window.removeEventListener('resize', measure);
                };
            });
        },
        measureRendered(elements: () => Iterable<TElement>) {
            $effect(() => {
                void version;
                for (const node of elements()) {
                    if (node.offsetHeight === 0) continue;

                    virtualizer.measureElement(node);
                }
                virtualizer.measureElement(null);
            });
        }
    };
}
