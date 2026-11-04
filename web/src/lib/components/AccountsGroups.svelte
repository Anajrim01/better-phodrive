<script lang="ts">
    import { onMount } from 'svelte';
    import AccountsPanel from '#components/AccountsPanel.svelte';
    import GroupsPanel from '#components/GroupsPanel.svelte';
    import { AccountsGroupsState } from '#browser/accounts-groups.svelte';

    interface Props {
        disabled: boolean;
        replacingToken: boolean;
        onreplacetoken: (accountId: string, token: string) => Promise<boolean>;
        onresourceschange: () => void;
    }

    let { disabled, replacingToken, onreplacetoken, onresourceschange }: Props = $props();

    const blocked = $derived(disabled || replacingToken);
    const model = new AccountsGroupsState(
        () => onresourceschange(),
        () => blocked
    );

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
        <AccountsPanel {model} disabled={blocked} {replacingToken} {onreplacetoken} />
        <GroupsPanel {model} disabled={blocked} />
    {/if}
</section>
