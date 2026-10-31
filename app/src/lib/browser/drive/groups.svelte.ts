import { GroupNameSchema, type Group } from '@madkarmaa/phodrive-core/models';
import type { BrowserPreferences } from '#browser/storage';

export class DriveGroups {
    pausedEmails = $state<string[]>([]);
    error = $state('');

    constructor(
        private readonly preferences: () => BrowserPreferences | null,
        private readonly accounts: () => Record<string, string>
    ) {}

    get groups(): Group[] {
        return this.preferences()?.groups ?? [];
    }

    get connectedAccounts(): string[] {
        return Object.keys(this.accounts());
    }

    isPaused(email: string): boolean {
        return this.pausedEmails.includes(email.toLowerCase());
    }

    setPausedEmails(emails: readonly string[]): void {
        this.pausedEmails = [...new Set(emails.map((email) => email.toLowerCase()))];
    }

    markPaused(email: string): void {
        const wanted = email.toLowerCase();
        if (this.pausedEmails.includes(wanted)) return;

        this.pausedEmails = [...this.pausedEmails, wanted];
    }

    create(name: string, accounts: readonly string[]): boolean {
        const parsed = GroupNameSchema.safeParse(name);
        if (!parsed.success) {
            this.fail(parsed.error.issues[0]?.message ?? 'Enter a group name.');

            return false;
        }
        if (this.groups.some((group) => group.name.toLowerCase() === parsed.data.toLowerCase())) {
            this.fail(`A group named ${parsed.data} already exists.`);

            return false;
        }

        const members = [...new Set(accounts.map((email) => email.toLowerCase()))];
        if (members.length < 2) {
            this.fail('Choose at least two accounts for a group.');

            return false;
        }
        if (members.some((email) => !this.isConnected(email))) {
            this.fail('Connect every chosen account before creating the group.');

            return false;
        }

        return this.persist([
            ...this.groups,
            { id: crypto.randomUUID(), name: parsed.data, accounts: members }
        ]);
    }

    rename(id: string, name: string): boolean {
        const parsed = GroupNameSchema.safeParse(name);
        if (!parsed.success) {
            this.fail(parsed.error.issues[0]?.message ?? 'Enter a group name.');

            return false;
        }
        if (
            this.groups.some(
                (group) => group.id !== id && group.name.toLowerCase() === parsed.data.toLowerCase()
            )
        ) {
            this.fail(`A group named ${parsed.data} already exists.`);

            return false;
        }

        return this.update(id, { name: parsed.data });
    }

    delete(id: string): boolean {
        return this.persist(this.groups.filter((group) => group.id !== id));
    }

    addMember(id: string, email: string): boolean {
        const group = this.groups.find((current) => current.id === id);
        if (!group) return false;
        if (!this.isConnected(email)) {
            this.fail('Connect that account before adding it to a group.');

            return false;
        }
        if (group.accounts.some((account) => account.toLowerCase() === email.toLowerCase())) {
            this.fail(`${email} is already in ${group.name}.`);

            return false;
        }

        return this.update(id, { accounts: [...group.accounts, email.toLowerCase()] });
    }

    removeMember(id: string, email: string): boolean {
        const group = this.groups.find((current) => current.id === id);
        if (!group) return false;
        if (group.accounts.length === 1) {
            this.fail('A group needs at least one account. Delete the group instead.');

            return false;
        }

        const accounts = group.accounts.filter(
            (account) => account.toLowerCase() !== email.toLowerCase()
        );
        if (accounts.length === group.accounts.length) return false;

        return this.update(id, { accounts });
    }

    private isConnected(email: string): boolean {
        const wanted = email.toLowerCase();

        return Object.keys(this.accounts()).some((account) => account.toLowerCase() === wanted);
    }

    private update(id: string, change: Partial<Pick<Group, 'name' | 'accounts'>>): boolean {
        return this.persist(
            this.groups.map((group) => (group.id === id ? { ...group, ...change } : group))
        );
    }

    private fail(message: string): void {
        this.error = message;
    }

    private persist(groups: Group[]): boolean {
        const preferences = this.preferences();
        if (!preferences) {
            this.fail('Browser storage is unavailable. Enable it to save groups.');

            return false;
        }

        return preferences.saveGroups(groups).match({
            Ok: () => {
                this.error = '';

                return true;
            },
            Err: (error) => {
                this.fail(error.message);

                return false;
            }
        });
    }
}
