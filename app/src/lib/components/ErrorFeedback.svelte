<script lang="ts">
    import { Snackbar } from 'noph-ui';
    import IconClose from '~icons/material-symbols/close';

    let { message = $bindable('') }: { message?: string } = $props();
</script>

<Snackbar
    class="error-feedback"
    style="max-height: 40vh"
    label={message}
    timeout={0}
    bind:open={
        () => !!message,
        (open) => {
            if (!open) message = '';
        }
    }
    iconAriaLabel="Dismiss error"
>
    {#snippet icon()}<IconClose aria-hidden="true" />{/snippet}
</Snackbar>

<style>
    :global(:root .error-feedback.np-snackbar[popover]) {
        inset: auto auto 24px 24px;
        margin: 0;
        min-width: 0;
        max-width: min(560px, calc(100vw - 32px));
        overflow: hidden;
    }

    :global(:root .error-feedback.np-snackbar .np-snackbar-inner) {
        max-height: inherit;
    }

    :global(:root .error-feedback.np-snackbar .np-snackbar-label-container) {
        max-height: inherit;
        overflow-y: auto;
        overscroll-behavior: contain;
    }

    :global(:root .error-feedback.np-snackbar .np-snackbar-label) {
        display: block;
        -webkit-line-clamp: unset;
        line-clamp: unset;
        text-wrap: wrap;
        overflow-wrap: anywhere;
    }

    @media (max-width: 800px) {
        :global(:root .error-feedback.np-snackbar[popover]) {
            inset: auto 16px calc(88px + env(safe-area-inset-bottom, 0px));
        }
    }
</style>
