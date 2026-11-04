<script lang="ts">
    import { onMount } from 'svelte';
    import AccountsPanel from '#components/AccountsPanel.svelte';
    import GroupsPanel from '#components/GroupsPanel.svelte';
    import { AccountsGroupsState } from '#browser/accounts-groups.svelte';

    interface Props {
        replacingToken: boolean;
        onreplacetoken: (accountId: string, token: string) => Promise<boolean>;
        onresourceschange: () => void;
    }

    let { replacingToken, onreplacetoken, onresourceschange }: Props = $props();

    const model = new AccountsGroupsState(() => onresourceschange());

    onMount(() => {
        void model.load();
    });
</script>

<section class="grid gap-6" aria-label="Google accounts and groups">
    {#if model.error}
        <p class="text-sm text-error" role="alert">{model.error}</p>
    {/if}

    {#if model.loading}
        <p class="text-sm text-muted" role="status">Loading accounts and groups</p>
    {:else}
        <AccountsPanel {model} {replacingToken} {onreplacetoken} />
        <GroupsPanel {model} />
    {/if}
</section>
