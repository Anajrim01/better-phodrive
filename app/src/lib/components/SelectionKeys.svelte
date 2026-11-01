<script lang="ts">
    interface Props {
        canSelectAll: boolean;
        canClear: boolean;
        onselectall: () => void;
        onclear: () => void;
    }

    let { canSelectAll, canClear, onselectall, onclear }: Props = $props();

    function editable(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false;
        if (target.isContentEditable) return true;
        if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
            return true;
        if (!(target instanceof HTMLInputElement)) return false;

        return ![
            'checkbox',
            'radio',
            'button',
            'submit',
            'reset',
            'range',
            'color',
            'file'
        ].includes(target.type);
    }

    function keydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || editable(event.target)) return;

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            if (!canSelectAll) return;

            event.preventDefault();
            onselectall();

            return;
        }

        if (event.key === 'Escape' && canClear) {
            event.preventDefault();
            onclear();
        }
    }
</script>

<svelte:window onkeydown={keydown} />
