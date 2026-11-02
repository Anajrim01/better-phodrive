type FileItemKeyOptions = {
    browseDisabled: boolean;
    select: (event: KeyboardEvent) => void;
    preview: (trigger: HTMLElement) => void;
};

export function focusedFileIndex(event: KeyboardEvent): number | null {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute('data-file-index')) return null;

    const index = Number(target.dataset.fileIndex);

    return Number.isInteger(index) ? index : null;
}

export function fileArrowStep(event: KeyboardEvent, columns: number): number | null {
    if (event.altKey || event.ctrlKey || event.metaKey) return null;
    if (event.key === 'ArrowDown') return columns;
    if (event.key === 'ArrowUp') return -columns;
    if (event.key === 'ArrowRight') return 1;
    if (event.key === 'ArrowLeft') return -1;

    return null;
}

export function handleFileItemKeydown(
    event: KeyboardEvent,
    { browseDisabled, select, preview }: FileItemKeyOptions
): void {
    const trigger = event.currentTarget;
    if (event.target !== trigger || browseDisabled) return;
    if (!(trigger instanceof HTMLElement)) return;

    if (event.key === ' ') {
        event.preventDefault();
        select(event);

        return;
    }

    if (event.key !== 'Enter') return;

    event.preventDefault();
    preview(trigger);
}
