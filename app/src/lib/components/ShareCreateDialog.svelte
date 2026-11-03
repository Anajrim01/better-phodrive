<script lang="ts">
    import { Button, Dialog, TextField } from 'noph-ui';
    import type { ShareRecord } from '@madkarmaa/phodrive-core/share-models';
    import { defaultShareName, shareNameError } from '#lib/share-files';
    import ShareCreateSuccess from '#components/ShareCreateSuccess.svelte';
    import ShareRecoveryKeys from '#components/ShareRecoveryKeys.svelte';
    import ShareSelectionList from '#components/ShareSelectionList.svelte';
    import IconCopy from '~icons/material-symbols/content-copy';
    import IconOpen from '~icons/material-symbols/open-in-new';

    type ShareDialogFile = { name: string; complete: boolean };

    interface Props {
        open?: boolean;
        files: readonly ShareDialogFile[];
        invalidReason?: string;
        busy: boolean;
        error?: string;
        errorCode?: string;
        recovery?: { envelopeKey?: string; albumKey: string } | null;
        record?: ShareRecord | null;
        storageNotice?: string;
        copyState?: 'idle' | 'copied' | 'manual' | 'failed';
        copyError?: string;
        oncreate: (name: string) => void;
        oncopy: (record: ShareRecord) => void;
        onclose: () => void;
    }

    let {
        open = $bindable(false),
        files,
        invalidReason = '',
        busy,
        error = '',
        errorCode = '',
        recovery = null,
        record = null,
        storageNotice = '',
        copyState = 'idle',
        copyError = '',
        oncreate,
        oncopy,
        onclose
    }: Props = $props();

    let name = $state('');
    let input = $state<HTMLInputElement | HTMLTextAreaElement>();
    let touched = $state(false);
    let submitted = $state(false);
    let previousOpen = false;
    let previousSelection = '';

    const nameError = $derived(shareNameError(name));
    const showNameError = $derived((touched || submitted) && nameError !== null);
    const canCreate = $derived(
        files.length > 0 && invalidReason === '' && !busy && nameError === null
    );
    const retryable = $derived(
        errorCode === 'SHARE_LINK_NOT_LIVE' || errorCode === 'SHARE_LINK_UNCERTAIN'
    );
    const tooLarge = $derived(errorCode === 'SHARE_URL_TOO_LONG');

    $effect(() => {
        const selection = files.map((file) => `${file.name}:${file.complete}`).join('\n');

        if (open && (!previousOpen || selection !== previousSelection)) {
            name = defaultShareName(files);
            touched = false;
            submitted = false;
        }

        previousOpen = open;
        previousSelection = selection;
    });

    function submit(): void {
        submitted = true;
        if (!canCreate || record !== null) return;

        oncreate(name.trim());
    }
</script>

<Dialog
    bind:open
    headline={record === null ? 'Create share link' : 'Share link ready'}
    ontoggle={(event) => {
        if (event.newState === 'closed') {
            onclose();

            return;
        }

        queueMicrotask(() => {
            input?.focus();
            input?.select();
        });
    }}
>
    {#if record === null}
        <ShareSelectionList {files} {invalidReason} />

        <form
            class="mt-4"
            novalidate
            onsubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            <TextField
                label="Name"
                bind:value={name}
                bind:inputElement={input}
                issues={showNameError && nameError !== null ? [{ message: nameError }] : undefined}
                disabled={busy}
                autocomplete="off"
                spellcheck={false}
                onblur={() => (touched = true)}
                required
            />
        </form>

        {#if error}
            <p class="share-error mt-3" role="alert">{error}</p>
        {/if}

        {#if tooLarge}
            <p class="share-guidance mt-2">Remove some files from the selection and try again.</p>
        {/if}

        {#if recovery}
            <ShareRecoveryKeys {recovery} />
        {/if}
    {:else}
        <ShareCreateSuccess {record} {copyState} {copyError} {storageNotice} />
    {/if}

    {#snippet actions()}
        {#if record === null}
            <Button variant="text" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
            {#if tooLarge}
                <Button variant="text" onclick={() => (open = false)}>Choose fewer files</Button>
            {:else}
                {#if errorCode === 'SHARE_LINK_UNCERTAIN'}
                    <Button
                        variant="text"
                        href="https://photos.google.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Open Google Photos
                    </Button>
                {/if}
                <Button
                    variant="text"
                    type="button"
                    loading={busy}
                    loadingAriaLabel="Creating the share link"
                    disabled={!canCreate}
                    onclick={submit}
                >
                    {retryable ? 'Try again' : 'Create link'}
                </Button>
            {/if}
        {:else}
            <Button variant="text" onclick={() => oncopy(record)}>
                {#snippet start()}<IconCopy aria-hidden="true" />{/snippet}
                Copy link
            </Button>
            <Button variant="text" href={record.shareUrl} target="_blank" rel="noopener noreferrer">
                {#snippet start()}<IconOpen aria-hidden="true" />{/snippet}
                Open link
            </Button>
            <Button variant="text" onclick={() => (open = false)}>Done</Button>
        {/if}
    {/snippet}
</Dialog>

<style>
    .share-error {
        color: var(--np-color-error);
        font-size: 0.875rem;
        line-height: 1.25rem;
    }

    .share-guidance {
        margin: 0;
        color: var(--app-muted);
        font-size: 0.875rem;
        line-height: 1.25rem;
    }
</style>
