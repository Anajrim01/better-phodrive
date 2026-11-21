<script lang="ts">
    import { onMount } from 'svelte';
    import { Button, LoadingIndicator } from 'noph-ui';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { DriveShares } from '#browser/drive/shares.svelte';

    interface Props {
        shares: DriveShares;
        disabled: boolean;
        enabled: boolean;
    }

    let { shares, disabled, enabled }: Props = $props();

    onMount(() => {
        void shares.load();
    });
</script>

<div class="flex flex-1 flex-col" in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
    <div class="workspace-heading">
        <div>
            <h1 id="shares-heading">Shares</h1>
            <p class="mt-1 text-sm text-muted">
                Each share is a fixed snapshot. Later uploads, moves and renames do not change it.
            </p>
        </div>
    </div>

    {#if !enabled}
        <p class="mt-4 text-sm text-muted">
            Public sharing is off on this server. You can still revoke shares, but new shares and
            public downloads are unavailable.
        </p>
    {/if}
    {#if shares.loading}
        <div class="grid place-items-center px-6 py-12">
            <LoadingIndicator aria-label="Loading shares" />
        </div>
    {:else if shares.error}
        <p class="mt-4 text-sm text-error">{shares.error}</p>
    {:else if !shares.shares.length}
        <p class="mt-4 text-sm text-muted">No active shares</p>
    {:else}
        <ul class="mt-4 grid list-none gap-3 p-0" aria-labelledby="shares-heading">
            {#each shares.shares as share (share.id)}
                <li
                    class="flex min-w-0 flex-wrap items-start gap-2 rounded-xl border border-border bg-card p-4"
                >
                    <div class="min-w-0 flex-1">
                        <h2 class="m-0 truncate text-sm font-medium" title={share.name}>
                            {share.name}
                        </h2>
                        <p class="m-0 mt-1 text-xs text-muted">
                            {share.kind === 'folder'
                                ? `Folder · ${share.fileCount} ${share.fileCount === 1 ? 'file' : 'files'}`
                                : 'File'} ·
                            {new Date(share.createdAt).toLocaleDateString()}
                        </p>
                    </div>
                    <div class="flex shrink-0 flex-wrap items-center gap-1">
                        {#if enabled}
                            <Button
                                variant="text"
                                size="xs"
                                {disabled}
                                onclick={() => {
                                    void shares.copy(share);
                                }}
                            >
                                Copy link
                            </Button>
                        {/if}
                        <Button
                            variant="text"
                            size="xs"
                            disabled={disabled || !!shares.revoking}
                            loading={shares.revoking === share.id}
                            loadingAriaLabel={`Revoking ${share.name}`}
                            onclick={() => {
                                if (!confirm(`Revoke the public link for ${share.name}?`)) return;

                                void shares.revoke(share.id);
                            }}
                        >
                            Revoke
                        </Button>
                    </div>
                </li>
            {/each}
        </ul>
    {/if}
</div>
