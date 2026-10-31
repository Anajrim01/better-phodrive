<script lang="ts">
    import { Button, Checkbox, TextField } from 'noph-ui';
    import { GroupNameSchema } from '@madkarmaa/phodrive-core/models';
    import type { DriveGroups } from '#browser/drive/groups.svelte';
    import GroupCard from '#components/GroupCard.svelte';
    import IconGroup from '~icons/material-symbols/group';

    interface Props {
        store: DriveGroups;
    }

    let { store }: Props = $props();

    const groups = $derived(store.groups);
    const accounts = $derived(store.connectedAccounts);
    const pausedEmails = $derived(store.pausedEmails);

    let creating = $state(false);
    let name = $state('');
    let selected = $state<string[]>([]);
    let touched = $state(false);
    const nameValidation = $derived(GroupNameSchema.safeParse(name));
    const issues = $derived(
        touched && !nameValidation.success ? nameValidation.error.issues : undefined
    );
    const showForm = $derived(creating || groups.length === 0);

    function reset() {
        name = '';
        selected = [];
        touched = false;
        creating = false;
    }

    function submit() {
        touched = true;
        if (!nameValidation.success || selected.length < 2) return;
        if (store.create(name, selected)) reset();
    }
</script>

<section class="grid gap-4" aria-labelledby="groups-heading">
    <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
            <h2 id="groups-heading" class="text-base font-medium">Groups</h2>
            <p class="mt-1 text-sm leading-relaxed text-muted">
                Spread uploads across connected accounts. Each file stays on one account.
            </p>
        </div>
        {#if groups.length && !showForm}
            <Button type="button" size="xs" variant="outlined" onclick={() => (creating = true)}>
                New group
            </Button>
        {/if}
    </div>

    {#if groups.length === 0}
        <div class="flex items-start gap-3 rounded-xl bg-card p-4">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-muted">
                <IconGroup class="size-4.5" aria-hidden="true" />
            </span>
            <div class="min-w-0">
                <p class="text-sm font-medium">No groups yet</p>
                <p class="mt-1 text-xs leading-relaxed text-muted">
                    Create a group to spread uploads across accounts. A group needs at least two
                    connected accounts.
                </p>
            </div>
        </div>
    {/if}

    {#if showForm}
        <form
            class="grid gap-4 rounded-xl bg-card p-4 max-[520px]:p-3"
            novalidate
            onsubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            <div>
                <h3 class="text-sm font-medium">New group</h3>
                <p class="mt-1 text-xs leading-relaxed text-muted">
                    Choose a name and at least two connected accounts.
                </p>
            </div>

            <div class="max-w-80">
                <TextField
                    label="Group name"
                    bind:value={name}
                    {issues}
                    onblur={() => (touched = true)}
                    maxlength={80}
                />
            </div>

            <fieldset class="min-w-0">
                <legend class="text-sm">Accounts</legend>
                {#if accounts.length < 2}
                    <p class="mt-1 text-xs text-muted">
                        Connect another account before creating a group.
                    </p>
                {:else}
                    <div class="mt-2 grid gap-1">
                        {#each accounts as email (email)}
                            <label class="flex min-h-9 items-center gap-3 text-sm">
                                <Checkbox bind:group={selected} value={email} />
                                <span class="truncate">{email}</span>
                            </label>
                        {/each}
                    </div>
                {/if}
            </fieldset>

            <div class="flex flex-wrap items-center gap-2">
                <Button
                    type="submit"
                    size="xs"
                    variant="tonal"
                    disabled={accounts.length < 2 || selected.length < 2}
                >
                    Create group
                </Button>
                {#if groups.length}
                    <Button type="button" size="xs" variant="text" onclick={reset}>Cancel</Button>
                {/if}
            </div>
        </form>
    {/if}

    {#if groups.length}
        <div class="grid gap-3">
            {#each groups as group (group.id)}
                <GroupCard
                    {group}
                    {accounts}
                    {pausedEmails}
                    onrename={(value) => store.rename(group.id, value)}
                    ondelete={() => store.delete(group.id)}
                    onaddmember={(email) => store.addMember(group.id, email)}
                    onremovemember={(email) => store.removeMember(group.id, email)}
                />
            {/each}
        </div>
    {/if}
</section>
