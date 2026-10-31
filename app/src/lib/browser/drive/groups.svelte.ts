import { GroupNameSchema, type Group } from '@madkarmaa/phodrive-core/models';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import { GroupPauses, type GroupMemberStatus } from '#browser/drive/group-pauses.svelte';
import type { BrowserPreferences } from '#browser/storage';

export class DriveGroups {
    readonly pauses = new GroupPauses();
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

    pausedUntilFor(email: string): number {
        return this.pauses.until(email);
    }

    memberStatus(email: string, now?: number): GroupMemberStatus {
        return this.pauses.status(email, now);
    }

    isPaused(email: string): boolean {
        return this.pauses.isPaused(email);
    }

    markPaused(email: string, until: number): void {
        this.pauses.mark(email, until);
    }

    observe(email: string): void {
        this.pauses.observe(email);
    }

    applyAccountStates(accounts: readonly GroupAccountState[]): void {
        this.pauses.apply(accounts);
    }

    clearPauses(): void {
        this.pauses.clear();
    }

    clearError(): void {
        this.error = '';
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
        const group = this.groups.find((current) => current.id === id);
        const remaining = this.groups.filter((current) => current.id !== id);
        const saved = this.persist(remaining);
        if (saved && group) for (const email of group.accounts) this.forgetUnused(email, remaining);

        return saved;
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

        const nextGroups = this.groups.map((current) =>
            current.id === id ? { ...current, accounts } : current
        );
        const saved = this.update(id, { accounts });
        if (saved) this.forgetUnused(email, nextGroups);

        return saved;
    }

    private forgetUnused(email: string, groups: readonly Group[]): void {
        const wanted = email.toLowerCase();
        const stillUsed = groups.some((group) =>
            group.accounts.some((account) => account.toLowerCase() === wanted)
        );
        if (!stillUsed) this.pauses.forget(email);
    }

    private isConnected(email: string): boolean {
        const wanted = email.toLowerCase();

        return Object.keys(this.accounts()).some((account) => account.toLowerCase() === wanted);
    }

    private update(id: string, change: Partial<Pick<Group, 'name' | 'accounts'>>): boolean {
        return this.persist(
            this.groups.map((current) => (current.id === id ? { ...current, ...change } : current))
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
