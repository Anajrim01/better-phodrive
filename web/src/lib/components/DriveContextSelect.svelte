<script lang="ts">
    import type { DriveContextSelection } from '#browser/storage';
    import type { DriveContextState } from '#browser/drive/context.svelte';

    interface Props {
        context: DriveContextState;
        disabled: boolean;
        onchange: (selection: DriveContextSelection) => void;
    }

    let { context, disabled, onchange }: Props = $props();

    function choose(event: Event) {
        const [kind, ...rest] = (event.currentTarget as HTMLSelectElement).value.split(':');
        const id = rest.join(':');
        if ((kind !== 'account' && kind !== 'group') || !id) return;

        onchange({ kind, id });
    }
</script>

<!-- Context load failures stay beside the selector; drive actions report their own errors. -->
{#if context.error}
    <p class="mb-3 px-1 text-xs text-error" role="alert">{context.error}</p>
{:else if context.loading}
    <p class="mb-3 px-1 text-xs text-muted" role="status">Loading accounts</p>
{:else if context.accounts.length === 0}
    <p class="mb-3 px-1 text-xs text-muted">No Google accounts are connected.</p>
{:else if context.showSelector}
    <label class="mb-3 grid gap-1 px-1 text-xs text-muted">
        Library
        <select
            class="h-9 min-w-0 rounded-lg border border-border bg-surface px-2 text-sm text-text"
            value={context.selectionKey}
            {disabled}
            onchange={choose}
        >
            <optgroup label="Google accounts">
                {#each context.accounts as account (account.id)}
                    <option value={`account:${account.id}`}>{account.email}</option>
                {/each}
            </optgroup>
            {#if context.groups.length}
                <optgroup label="Groups">
                    {#each context.groups as group (group.id)}
                        <option value={`group:${group.id}`}>
                            {group.name} ({group.members.length})
                        </option>
                    {/each}
                </optgroup>
            {/if}
        </select>
    </label>

    {#if context.current?.kind === 'group'}
        <p class="mb-3 px-1 text-xs leading-relaxed text-muted" role="status">
            Select an individual account to upload.
        </p>
    {/if}
{/if}
