import type { GoogleAccountGroup, GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
import { listGoogleAccounts, listGoogleGroups } from '#browser/accounts';
import type { BrowserPreferences, DriveContextSelection } from '#browser/storage';

export type DriveContext =
    | { kind: 'account'; account: GoogleAccountSummary }
    | { kind: 'group'; group: GoogleAccountGroup };

function contextId(context: DriveContext): string {
    return context.kind === 'account' ? context.account.id : context.group.id;
}

/** Resolve the saved account or group selection against the signed-in user's current resources. */
export class DriveContextState {
    accounts = $state<GoogleAccountSummary[]>([]);
    groups = $state<GoogleAccountGroup[]>([]);
    current = $state<DriveContext | null>(null);
    loading = $state(true);
    error = $state('');

    constructor(
        private readonly preferences: () => BrowserPreferences | null,
        private readonly feedback: (message: string) => void
    ) {}

    get canUpload(): boolean {
        return this.current?.kind === 'account';
    }

    get showSelector(): boolean {
        return !this.loading && (this.accounts.length > 1 || this.groups.length > 0);
    }

    get selectionKey(): string {
        return this.current ? `${this.current.kind}:${contextId(this.current)}` : '';
    }

    async load(): Promise<void> {
        this.loading = true;
        this.error = '';

        const [accountsResult, groupsResult] = await Promise.all([
            listGoogleAccounts(),
            listGoogleGroups()
        ]);

        if (accountsResult.isErr()) {
            this.error = accountsResult.unwrapErr().message;
            this.loading = false;

            return;
        }
        if (groupsResult.isErr()) {
            this.error = groupsResult.unwrapErr().message;
            this.loading = false;

            return;
        }

        this.accounts = accountsResult.unwrap();
        this.groups = groupsResult.unwrap();
        this.current = this.resolve(this.preferences()?.driveContext);
        this.loading = false;
    }

    select(selection: DriveContextSelection): boolean {
        const resolved = this.resolve(selection);
        if (!resolved) return false;

        this.current = resolved;

        const preferences = this.preferences();
        if (preferences) {
            const saved = preferences.saveDriveContext(selection);
            if (saved.isErr()) this.feedback(saved.unwrapErr().message);
        }

        return true;
    }

    private resolve(selection: DriveContextSelection | undefined): DriveContext | null {
        if (selection?.kind === 'group') {
            const group = this.groups.find((current) => current.id === selection.id);
            if (group) return { kind: 'group', group };
        }

        if (selection?.kind === 'account') {
            const account = this.accounts.find((current) => current.id === selection.id);
            if (account) return { kind: 'account', account };
        }

        const [account] = this.accounts;

        return account ? { kind: 'account', account } : null;
    }
}
