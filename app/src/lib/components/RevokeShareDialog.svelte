<script lang="ts">
    import { Button, Dialog } from 'noph-ui';
    import type { ShareRecord } from '@madkarmaa/phodrive-core/share-models';
    import IconOpen from '~icons/material-symbols/open-in-new';

    interface Props {
        open?: boolean;
        record: ShareRecord | null;
        busy: boolean;
        error?: string;
        errorCode?: string;
        recovery?: { envelopeKey?: string; albumKey: string } | null;
        onrevoke: () => void;
        onclose: () => void;
    }

    let {
        open = $bindable(false),
        record,
        busy,
        error = '',
        errorCode = '',
        recovery = null,
        onrevoke,
        onclose
    }: Props = $props();

    let cancelButton = $state<HTMLElement>();

    const body = $derived(
        record === null
            ? ''
            : `The link for ${record.name} stops working. Downloaded copies stay with the people who saved them.`
    );
    const uncertain = $derived(
        errorCode === 'SHARE_REVOKE_UNVERIFIED' || errorCode === 'SHARE_LINK_STILL_LIVE'
    );
</script>

<Dialog
    bind:open
    headline="Revoke share link?"
    supportingText={body}
    ontoggle={(event) => {
        if (event.newState === 'closed') onclose();
        else cancelButton?.focus();
    }}
>
    {#if error}
        <p class="mt-3 text-sm text-error" role="alert">{error}</p>
    {/if}

    {#if recovery}
        <div class="mt-3 grid gap-2 text-sm">
            <p class="m-0 leading-relaxed text-muted">
                Google may still serve the link. These keys identify the shared album if you need to
                remove it in Google Photos.
            </p>
            <dl class="grid gap-1.5 text-xs">
                {#if recovery.envelopeKey}
                    <div class="flex flex-wrap items-baseline gap-2">
                        <dt class="text-muted">Envelope key</dt>
                        <dd class="m-0 min-w-0">
                            <code class="font-mono break-all select-all"
                                >{recovery.envelopeKey}</code
                            >
                        </dd>
                    </div>
                {/if}
                <div class="flex flex-wrap items-baseline gap-2">
                    <dt class="text-muted">Album key</dt>
                    <dd class="m-0 min-w-0">
                        <code class="font-mono break-all select-all">{recovery.albumKey}</code>
                    </dd>
                </div>
            </dl>
        </div>
    {/if}

    {#snippet actions()}
        <Button
            bind:element={cancelButton}
            variant="text"
            disabled={busy}
            onclick={() => (open = false)}
        >
            Cancel
        </Button>
        {#if uncertain && record !== null}
            <Button variant="text" href={record.shareUrl} target="_blank" rel="noopener noreferrer">
                {#snippet start()}<IconOpen aria-hidden="true" />{/snippet}
                Check link
            </Button>
        {/if}
        <Button
            variant="text"
            loading={busy}
            loadingAriaLabel="Revoking the share link"
            disabled={record === null || busy}
            onclick={onrevoke}
        >
            {uncertain ? 'Try revoke again' : 'Revoke link'}
        </Button>
    {/snippet}
</Dialog>
