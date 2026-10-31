<script lang="ts">
    import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';

    interface Props {
        groupName: string;
        total: number;
        accounts: readonly GroupAccountState[];
    }

    let { groupName, total, accounts }: Props = $props();

    const paused = $derived(accounts.filter((account) => account.status === 'paused'));
    const failed = $derived(accounts.filter((account) => account.status === 'error'));
    const allPaused = $derived(accounts.length > 0 && paused.length === accounts.length);
    const pausedNames = $derived(
        paused
            .map((account) =>
                account.retryAfterSeconds === undefined
                    ? account.email
                    : `${account.email} (${account.retryAfterSeconds}s)`
            )
            .join(', ')
    );
    const failedNames = $derived(failed.map((account) => account.email).join(', '));
</script>

<div
    class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-card px-3 py-2 text-xs"
    role="status"
>
    <span class="text-text">{groupName}</span>
    <span class="text-muted tabular-nums">
        {total}
        {total === 1 ? 'account' : 'accounts'}
    </span>
    {#if allPaused}
        <span class="text-muted">
            Every member is paused. Files return when an account answers.
        </span>
    {:else if paused.length}
        <span class="text-muted">
            Paused: {pausedNames}. Files from paused accounts stay hidden until they answer.
        </span>
    {:else if failed.length}
        <span class="text-muted">
            Could not load {failedNames}. The list is partial.
        </span>
    {/if}
</div>
