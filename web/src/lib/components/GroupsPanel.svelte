<script lang="ts">
    import { Button, TextField } from 'noph-ui';
    import type { GoogleAccountGroup, GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
    import type { AccountsGroupsState } from '#browser/accounts-groups.svelte';
    import IconClose from '~icons/material-symbols/close';

    interface Props {
        model: AccountsGroupsState;
    }

    let { model }: Props = $props();

    let groupName = $state('');
    let memberChoice = $state<Record<string, string>>({});

    async function createGroup() {
        if (await model.createGroup(groupName.trim())) groupName = '';
    }

    async function deleteGroup(group: GoogleAccountGroup) {
        if (!confirm(`Delete ${group.name}? The accounts stay connected.`)) return;

        await model.deleteGroup(group);
    }

    async function addMember(group: GoogleAccountGroup) {
        const accountId = memberChoice[group.id];
        if (!accountId || !(await model.addMember(group, accountId))) return;

        memberChoice[group.id] = '';
    }

    function availableAccounts(group: GoogleAccountGroup) {
        const members = new Set(group.members.map((member) => member.id));

        return model.accounts.filter((account) => !members.has(account.id));
    }
</script>

<div>
    <h2 class="text-base font-medium">Groups</h2>
    <p class="mt-1 text-sm leading-relaxed text-muted">
        A group collects connected accounts. Removing a member does not disconnect the account or
        move its files.
    </p>
</div>

{#if model.groups.length === 0}
    <p class="text-sm text-muted">No groups yet.</p>
{/if}

<ul class="grid gap-3">
    {#each model.groups as group (group.id)}
        <li class="grid gap-3 rounded-xl bg-panel p-3">
            <div class="flex items-center gap-3">
                <h3 class="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</h3>
                <Button
                    variant="text"
                    size="xs"
                    aria-label={`Delete ${group.name}`}
                    disabled={Boolean(model.busy)}
                    onclick={() => deleteGroup(group)}
                >
                    Delete group
                </Button>
            </div>

            {#if group.members.length}
                <ul class="flex flex-wrap gap-2">
                    {#each group.members as member (member.id)}
                        <li
                            class="flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs"
                        >
                            <span>{member.email}</span>
                            <button
                                type="button"
                                class="text-muted hover:text-error"
                                aria-label={`Remove ${member.email} from ${group.name}`}
                                disabled={Boolean(model.busy)}
                                onclick={() => model.removeMember(group, member)}
                            >
                                <IconClose class="size-3.5" aria-hidden="true" />
                            </button>
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="text-sm text-muted">No accounts in this group.</p>
            {/if}

            <div class="flex flex-wrap items-end gap-2">
                <label class="grid min-w-48 flex-1 gap-1 text-xs text-muted">
                    Add an account
                    <select
                        class="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text"
                        bind:value={memberChoice[group.id]}
                        disabled={Boolean(model.busy) || availableAccounts(group).length === 0}
                    >
                        <option value="">Choose an account</option>
                        {#each availableAccounts(group) as account (account.id)}
                            <option value={account.id}>{account.email}</option>
                        {/each}
                    </select>
                </label>
                <Button
                    variant="tonal"
                    size="s"
                    disabled={Boolean(model.busy) || !memberChoice[group.id]}
                    onclick={() => addMember(group)}
                >
                    Add member
                </Button>
            </div>
        </li>
    {/each}
</ul>

<form
    class="flex flex-wrap items-end gap-3"
    novalidate
    onsubmit={(event) => {
        event.preventDefault();
        void createGroup();
    }}
>
    <div class="min-w-64 flex-1">
        <TextField
            label="New group name"
            name="groupName"
            bind:value={groupName}
            disabled={Boolean(model.busy)}
            required
        />
    </div>
    <Button
        type="submit"
        variant="tonal"
        loading={model.busy === 'create-group'}
        loadingAriaLabel="Creating group"
    >
        Create group
    </Button>
</form>
