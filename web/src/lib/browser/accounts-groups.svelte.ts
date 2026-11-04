import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { GoogleAccountGroup, GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
import type { AsyncResult } from 'results-ts';
import {
    addGoogleAccount,
    addGoogleGroupMember,
    createGoogleGroup,
    deleteGoogleGroup,
    listGoogleAccounts,
    listGoogleGroups,
    removeGoogleAccount,
    removeGoogleGroupMember
} from '#browser/accounts';

/** Account and group operations shown in settings; one mutation runs at a time. */
export class AccountsGroupsState {
    accounts = $state<GoogleAccountSummary[]>([]);
    groups = $state<GoogleAccountGroup[]>([]);
    loading = $state(true);
    error = $state('');
    busy = $state('');

    constructor(private readonly onchange: () => void = () => {}) {}

    async load(): Promise<void> {
        this.loading = true;
        this.error = '';

        const [accountsResult, groupsResult] = await Promise.all([
            listGoogleAccounts(),
            listGoogleGroups()
        ]);

        if (accountsResult.isErr()) this.error = accountsResult.unwrapErr().message;
        else this.accounts = accountsResult.unwrap();

        if (groupsResult.isErr()) this.error = groupsResult.unwrapErr().message;
        else this.groups = groupsResult.unwrap();

        this.loading = false;
    }

    addAccount(email: string, token: string): Promise<boolean> {
        return this.mutate('add-account', () => addGoogleAccount(email, token));
    }

    disconnect(account: GoogleAccountSummary): Promise<boolean> {
        return this.mutate(account.id, () => removeGoogleAccount(account.id));
    }

    createGroup(name: string): Promise<boolean> {
        return this.mutate('create-group', () => createGoogleGroup(name));
    }

    deleteGroup(group: GoogleAccountGroup): Promise<boolean> {
        return this.mutate(group.id, () => deleteGoogleGroup(group.id));
    }

    addMember(group: GoogleAccountGroup, accountId: string): Promise<boolean> {
        return this.mutate(group.id, () => addGoogleGroupMember(group.id, accountId));
    }

    removeMember(group: GoogleAccountGroup, account: GoogleAccountSummary): Promise<boolean> {
        return this.mutate(group.id, () => removeGoogleGroupMember(group.id, account.id));
    }

    private async mutate<T>(
        key: string,
        task: () => AsyncResult<T, ApplicationError>
    ): Promise<boolean> {
        if (this.busy) return false;

        this.busy = key;
        this.error = '';
        const result = await task();
        this.busy = '';

        if (result.isErr()) {
            this.error = result.unwrapErr().message;

            return false;
        }

        await this.load();
        this.onchange();

        return true;
    }
}
