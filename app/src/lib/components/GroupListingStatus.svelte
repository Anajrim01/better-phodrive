<script lang="ts">
    import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';

    interface Props {
        groupName: string;
        total: number;
        accounts: readonly GroupAccountState[];
    }

    let { groupName, total, accounts }: Props = $props();

    let now = $state(Date.now());
    let loadedAt = $state(Date.now());
    const paused = $derived(accounts.filter((account) => account.status === 'paused'));
    const failed = $derived(accounts.filter((account) => account.status === 'error'));
    const missing = $derived(
        failed.filter((account) => account.message?.includes('is not connected'))
    );
    const errored = $derived(
        failed.filter((account) => !account.message?.includes('is not connected'))
    );
    const allPaused = $derived(accounts.length > 0 && paused.length === accounts.length);
    const failedNames = $derived(errored.map((account) => account.email).join(', '));
    const missingNames = $derived(missing.map((account) => account.email).join(', '));

    $effect(() => {
        void accounts;
        loadedAt = Date.now();
        now = Date.now();
        if (!paused.some((account) => account.retryAfterSeconds !== undefined)) return;

        const timer = setInterval(() => {
            now = Date.now();
        }, 1_000);

        return () => clearInterval(timer);
    });

    function remaining(account: GroupAccountState): number | null {
        if (account.retryAfterSeconds === undefined) return null;

        return Math.max(0, Math.ceil((loadedAt + account.retryAfterSeconds * 1_000 - now) / 1_000));
    }

    const pausedNames = $derived(
        paused
            .map((account) => {
                const seconds = remaining(account);

                return seconds === null ? account.email : `${account.email} (${seconds}s)`;
            })
            .join(', ')
    );
    const allPausedRemaining = $derived(
        Math.min(...paused.map((account) => remaining(account) ?? 0))
    );
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
            {#if allPausedRemaining > 0}
                Every member is paused. Files return in {allPausedRemaining}s.
            {:else}
                Every member is paused. Files return when an account answers.
            {/if}
        </span>
    {:else if paused.length}
        <span class="text-muted">
            Paused: {pausedNames}. Files from paused accounts stay hidden until they answer.
        </span>
    {/if}
    {#if errored.length}
        <span class="text-muted">
            Could not load {failedNames}. The list is partial.
        </span>
    {/if}
    {#if missing.length}
        <span class="text-muted">
            Not connected: {missingNames}. Their files stay hidden until they are added back.
        </span>
    {/if}
</div>
