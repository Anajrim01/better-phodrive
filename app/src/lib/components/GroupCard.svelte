<script lang="ts">
    import { Button, IconButton, Select, TextField } from 'noph-ui';
    import { GroupNameSchema, type Group } from '@madkarmaa/phodrive-core/models';
    import { groupReadiness } from '#browser/drive/group-state';
    import IconClose from '~icons/material-symbols/close';
    import IconDelete from '~icons/material-symbols/delete-outline';
    import IconEdit from '~icons/material-symbols/edit';

    interface Props {
        group: Group;
        accounts: readonly string[];
        pausedEmails: readonly string[];
        onrename: (name: string) => boolean;
        ondelete: () => void;
        onaddmember: (email: string) => void;
        onremovemember: (email: string) => void;
    }

    let { group, accounts, pausedEmails, onrename, ondelete, onaddmember, onremovemember }: Props =
        $props();

    let renaming = $state(false);
    let deleting = $state(false);
    let removing = $state('');
    let draft = $state('');
    let touched = $state(false);
    let selected = $state('');
    const readiness = $derived(groupReadiness(group, pausedEmails));
    const paused = $derived(new Set(pausedEmails.map((email) => email.toLowerCase())));
    const available = $derived(
        accounts.filter(
            (email) =>
                !group.accounts.some((member) => member.toLowerCase() === email.toLowerCase())
        )
    );
    const options = $derived([
        { value: '', label: 'Choose an account', disabled: true },
        ...available.map((email) => ({ value: email, label: email }))
    ]);
    const nameValidation = $derived(GroupNameSchema.safeParse(draft));
    const issues = $derived(
        touched && !nameValidation.success ? nameValidation.error.issues : undefined
    );

    function startRename() {
        draft = group.name;
        touched = false;
        renaming = true;
        deleting = false;
        removing = '';
    }

    function submitRename() {
        touched = true;
        if (!nameValidation.success) return;
        if (onrename(draft)) renaming = false;
    }

    function confirmRemove() {
        onremovemember(removing);
        removing = '';
    }

    function confirmDelete() {
        ondelete();
        deleting = false;
    }
</script>

<article class="rounded-xl bg-card p-4 max-[520px]:p-3">
    <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
            <h3 class="truncate text-sm font-medium">{group.name}</h3>
            <p class="mt-0.5 text-xs text-muted tabular-nums">
                {group.accounts.length}
                {group.accounts.length === 1 ? 'account' : 'accounts'}
            </p>
        </div>
        <div class="flex shrink-0 items-center">
            <IconButton size="xs" title="Rename {group.name}" onclick={startRename}>
                <IconEdit aria-hidden="true" />
            </IconButton>
            <IconButton
                size="xs"
                title="Delete {group.name}"
                onclick={() => {
                    deleting = true;
                    renaming = false;
                    removing = '';
                }}
            >
                <IconDelete aria-hidden="true" />
            </IconButton>
        </div>
    </div>

    {#if renaming}
        <form
            class="mt-3 flex flex-wrap items-start gap-2"
            novalidate
            onsubmit={(event) => {
                event.preventDefault();
                submitRename();
            }}
        >
            <div class="min-w-40 flex-1">
                <TextField
                    label="Group name"
                    bind:value={draft}
                    {issues}
                    onblur={() => (touched = true)}
                    autofocus
                />
            </div>
            <Button type="submit" size="xs" variant="tonal">Save</Button>
            <Button type="button" size="xs" variant="text" onclick={() => (renaming = false)}>
                Cancel
            </Button>
        </form>
    {/if}

    <ul class="mt-3 divide-y divide-border/40 border-y border-border/40">
        {#each group.accounts as email (email)}
            <li class="flex min-h-10 items-center gap-3 py-1.5">
                <span
                    class="size-2 shrink-0 rounded-full"
                    class:bg-success={!paused.has(email.toLowerCase())}
                    class:bg-outline={paused.has(email.toLowerCase())}
                    aria-hidden="true"
                ></span>
                <span class="min-w-0 flex-1 truncate text-sm">{email}</span>
                <span class="shrink-0 text-xs text-muted">
                    {paused.has(email.toLowerCase()) ? 'Paused' : 'Ready'}
                </span>
                <IconButton
                    size="xs"
                    title={group.accounts.length === 1
                        ? 'A group needs at least one account'
                        : `Remove ${email} from ${group.name}`}
                    disabled={group.accounts.length === 1}
                    onclick={() => {
                        removing = email;
                        renaming = false;
                        deleting = false;
                    }}
                >
                    <IconClose aria-hidden="true" />
                </IconButton>
            </li>
        {/each}
    </ul>

    {#if readiness === 'needs-members'}
        <p class="mt-3 text-xs text-muted">
            Add one more account before uploading with this group.
        </p>
    {:else if readiness === 'all-paused'}
        <p class="mt-3 text-xs text-muted">
            Every member is paused. Uploads wait until one recovers.
        </p>
    {/if}

    {#if available.length}
        <div class="mt-3 flex items-end gap-2">
            <div class="min-w-0 flex-1">
                <Select label="Add account" {options} bind:value={selected} />
            </div>
            <Button
                type="button"
                size="xs"
                variant="outlined"
                disabled={!selected}
                onclick={() => {
                    onaddmember(selected);
                    selected = '';
                }}>Add</Button
            >
        </div>
    {/if}

    {#if removing}
        <div class="mt-3 rounded-lg bg-hover p-3">
            <p class="text-sm">Remove {removing}?</p>
            <p class="mt-1 text-xs text-muted">Files already uploaded stay with this account.</p>
            <div class="mt-3 flex gap-2">
                <Button type="button" size="xs" variant="tonal" onclick={confirmRemove}
                    >Remove</Button
                >
                <Button type="button" size="xs" variant="text" onclick={() => (removing = '')}>
                    Cancel
                </Button>
            </div>
        </div>
    {/if}

    {#if deleting}
        <div class="mt-3 rounded-lg bg-hover p-3">
            <p class="text-sm">Delete {group.name}?</p>
            <p class="mt-1 text-xs text-muted">Files already uploaded stay with their owners.</p>
            <div class="mt-3 flex gap-2">
                <Button type="button" size="xs" variant="tonal" onclick={confirmDelete}>
                    Delete group
                </Button>
                <Button type="button" size="xs" variant="text" onclick={() => (deleting = false)}>
                    Cancel
                </Button>
            </div>
        </div>
    {/if}
</article>
