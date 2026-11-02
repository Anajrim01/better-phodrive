type FileFocusOptions = {
    rows: () => unknown;
    count: () => number;
    key: (index: number) => string | undefined;
    container: () => ParentNode | undefined;
    row: (index: number) => number;
    scrollToRow: (row: number) => void;
};

export function createFileFocus(options: FileFocusOptions) {
    let pending = $state<number | null>(null);
    let targetKey: string | null = null;
    let stopFocusWatch: (() => void) | null = null;

    function cancelPending() {
        pending = null;
        targetKey = null;
        stopFocusWatch?.();
        stopFocusWatch = null;
    }

    function watchFocus() {
        stopFocusWatch?.();
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const index = Number(target.dataset.fileIndex);
            if (Number.isInteger(index) && index === pending) return;

            cancelPending();
        };
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            const item = target.closest<HTMLElement>('[data-file-index]');
            const index = Number(item?.dataset.fileIndex);
            if (Number.isInteger(index) && index === pending) return;

            cancelPending();
        };
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('pointerdown', onPointerDown, true);
        stopFocusWatch = () => {
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('pointerdown', onPointerDown, true);
        };
    }

    $effect(() => {
        const count = options.count();
        void options.rows();
        if (pending === null) return;

        if (pending < 0 || pending >= count) {
            cancelPending();

            return;
        }

        const active = document.activeElement;
        if (active && active !== document.body && !active.hasAttribute('data-file-index')) {
            cancelPending();

            return;
        }

        const element = options
            .container()
            ?.querySelector<HTMLElement>(`[data-file-index="${pending}"]`);
        if (!element) return;

        if (targetKey !== null && element.dataset.fileKey !== targetKey) {
            cancelPending();

            return;
        }

        element.focus();
        cancelPending();
    });

    $effect(() => () => cancelPending());

    return {
        get pending() {
            return pending;
        },
        cancel: cancelPending,
        move(index: number) {
            cancelPending();
            pending = index;
            targetKey = options.key(index) ?? null;
            watchFocus();
            options.scrollToRow(options.row(index));
        }
    };
}
