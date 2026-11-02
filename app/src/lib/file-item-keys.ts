type FileItemKeyOptions = {
    browseDisabled: boolean;
    select: (event: KeyboardEvent) => void;
    preview: (trigger: HTMLElement) => void;
};

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
