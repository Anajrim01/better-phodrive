<script lang="ts">
    import { Button, TextField } from 'noph-ui';
    import type { GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
    import TokenHelp from '#components/TokenHelp.svelte';
    import type { AccountsGroupsState } from '#browser/accounts-groups.svelte';
    import IconDelete from '~icons/material-symbols/delete-outline';

    interface Props {
        model: AccountsGroupsState;
        disabled: boolean;
        replacingToken: boolean;
        onreplacetoken: (accountId: string, token: string) => Promise<boolean>;
    }

    let { model, disabled, replacingToken, onreplacetoken }: Props = $props();

    const blocked = $derived(disabled || replacingToken || Boolean(model.busy));

    let email = $state('');
    let token = $state('');
    let showHelp = $state(false);
    let replacingAccount = $state('');
    let replacementToken = $state('');

    async function addAccount() {
        if (blocked) return;

        if (await model.addAccount(email.trim(), token.trim())) {
            email = '';
            token = '';
            showHelp = false;
        }
    }

    async function disconnect(account: GoogleAccountSummary) {
        if (blocked) return;

        if (
            !confirm(
                `Disconnect ${account.email}? Its cached metadata and group memberships are removed. Files stay in Google Photos.`
            )
        )
            return;

        await model.disconnect(account);
    }

    async function replaceToken() {
        if (!replacingAccount || blocked) return;
        if (!(await onreplacetoken(replacingAccount, replacementToken.trim()))) return;

        replacingAccount = '';
        replacementToken = '';
    }
</script>

<div>
    <h2 class="text-base font-medium">Google accounts</h2>
    <p class="mt-1 text-sm leading-relaxed text-muted">
        Connect the Google accounts this drive can use. The library selector chooses one account or
        a group.
    </p>
</div>

{#if model.accounts.length}
    <ul class="grid gap-2">
        {#each model.accounts as account (account.id)}
            <li class="grid gap-3 rounded-lg bg-panel px-3 py-2">
                <div class="flex items-center gap-3">
                    <span class="min-w-0 flex-1 truncate text-sm">{account.email}</span>
                    <Button
                        variant="text"
                        size="xs"
                        disabled={blocked}
                        onclick={() => {
                            replacingAccount = replacingAccount === account.id ? '' : account.id;
                            replacementToken = '';
                        }}
                    >
                        {replacingAccount === account.id ? 'Cancel' : 'Replace token'}
                    </Button>
                    <Button
                        variant="text"
                        size="xs"
                        aria-label={`Disconnect ${account.email}`}
                        disabled={blocked}
                        onclick={() => disconnect(account)}
                    >
                        <IconDelete class="size-4.5" aria-hidden="true" />
                        Disconnect
                    </Button>
                </div>

                {#if replacingAccount === account.id}
                    <form
                        class="flex flex-wrap items-end gap-2"
                        novalidate
                        onsubmit={(event) => {
                            event.preventDefault();
                            void replaceToken();
                        }}
                    >
                        <div class="min-w-64 flex-1">
                            <TextField
                                label={`New token for ${account.email}`}
                                name="replacementToken"
                                type="password"
                                bind:value={replacementToken}
                                disabled={blocked}
                                autocomplete="off"
                                required
                            />
                        </div>
                        <Button
                            type="submit"
                            variant="tonal"
                            size="s"
                            loading={replacingToken}
                            loadingAriaLabel="Replacing token"
                            disabled={blocked || !replacementToken.trim()}
                        >
                            Replace
                        </Button>
                    </form>
                {/if}
            </li>
        {/each}
    </ul>
{:else}
    <p class="text-sm text-muted">No Google accounts are connected.</p>
{/if}

<form
    class="grid gap-3"
    novalidate
    onsubmit={(event) => {
        event.preventDefault();
        void addAccount();
    }}
>
    <div class="grid gap-3 sm:grid-cols-2">
        <TextField
            label="Google account email"
            name="googleEmail"
            type="email"
            bind:value={email}
            disabled={blocked}
            autocomplete="email"
            required
        />
        <TextField
            label="OAuth2 or AAS token"
            name="googleToken"
            type="password"
            bind:value={token}
            disabled={blocked}
            autocomplete="off"
            required
        />
    </div>
    <div class="flex flex-wrap items-center gap-2">
        <Button
            type="submit"
            variant="tonal"
            loading={model.busy === 'add-account'}
            loadingAriaLabel="Adding account"
            disabled={blocked}
        >
            Add account
        </Button>
        <Button type="button" variant="text" onclick={() => (showHelp = !showHelp)}>
            {showHelp ? 'Hide steps' : 'How to get a token'}
        </Button>
    </div>
    {#if showHelp}
        <TokenHelp />
    {/if}
</form>
