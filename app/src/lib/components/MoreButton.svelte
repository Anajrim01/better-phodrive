<script lang="ts">
    import { IconButton } from 'noph-ui';
    import IconMore from '~icons/material-symbols/more-vert';

    interface Props {
        label: string;
        disabled?: boolean;
        onopen: (element: HTMLElement) => void;
    }

    let { label, disabled = false, onopen }: Props = $props();

    function menuKey(event: KeyboardEvent): boolean {
        return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    }
</script>

<IconButton
    size="xs"
    title={`More actions for ${label}`}
    aria-haspopup="menu"
    {disabled}
    onclick={(event) => {
        if (disabled) return;

        onopen(event.currentTarget);
    }}
    onkeydown={(event) => {
        if (disabled || !menuKey(event)) return;

        event.preventDefault();
        onopen(event.currentTarget);
    }}
>
    <IconMore aria-hidden="true" />
</IconButton>
