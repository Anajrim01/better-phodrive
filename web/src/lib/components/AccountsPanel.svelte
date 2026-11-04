<script lang="ts">
    import { Button, TextField } from 'noph-ui';
    import type { GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
    import TokenHelp from '#components/TokenHelp.svelte';
    import type { AccountsGroupsState } from '#browser/accounts-groups.svelte';
    import IconDelete from '~icons/material-symbols/delete-outline';

    interface Props {
        model: AccountsGroupsState;
        replacingToken: boolean;
        onreplacetoken: (accountId: string, token: string) => Promise<boolean>;
        onaccountschange: () => void;
    }

    let { model, replacingToken, onreplacetoken, onaccountschange }: Props = $props();

    let email = $state('');
    let token = $state('');
    let showHelp = $state(false);
    let replacingAccount = $state('');
    let replacementToken = $state('');

    async function addAccount() {
        if (await model.addAccount(email.trim(), token.trim())) {
            email = '';
            token = '';
            showHelp = false;
            onaccountschange();
        }
    }

    async function disconnect(account: GoogleAccountSummary) {
        if (
            !confirm(
                `Disconnect ${account.email}? Its cached metadata and group memberships are removed. Files stay in Google Photos.`
            )
        )
            return;

        if (await model.disconnect(account)) onaccountschange();
    }

    async function replaceToken() {
        if (!replacingAccount || replacingToken) return;
        if (!(await onreplacetoken(replacingAccount, replacementToken.trim()))) return;

        replacingAccount = '';
        replacementToken = '';
    }
</script>

<div>
    <h2 class="text-base font-medium">Google accounts</h2>
    <p class="mt-1 text-sm leading-relaxed text-muted">
        Connect the Google accounts this drive can use. Until group libraries arrive, the drive
        reads from the first connected account.
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
                        disabled={Boolean(model.busy) || replacingToken}
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
                        disabled={Boolean(model.busy) || replacingToken}
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
                                disabled={replacingToken}
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
                            disabled={!replacementToken.trim()}
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
            disabled={Boolean(model.busy)}
            autocomplete="email"
            required
        />
        <TextField
            label="OAuth2 or AAS token"
            name="googleToken"
            type="password"
            bind:value={token}
            disabled={Boolean(model.busy)}
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
