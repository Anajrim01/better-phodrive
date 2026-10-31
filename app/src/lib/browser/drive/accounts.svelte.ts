import { NewAccountSchema, type PreferencesDefaults } from '@madkarmaa/phodrive-core/models';
import { validateAccount } from '@madkarmaa/phodrive-core/browser/accounts';
import { createBrowserPreferences, type BrowserPreferences } from '#browser/storage';

export type AccountDeps = {
    defaults: PreferencesDefaults;
    blocked: () => boolean;
    feedback: (message: string) => void;
};

export class DriveAccounts {
    private store = $state.raw<BrowserPreferences | null>(null);
    adding = $state(false);
    newEmail = $state('');
    newToken = $state('');
    connecting = $state(false);

    constructor(private readonly deps: AccountDeps) {}

    get preferences(): BrowserPreferences | null {
        return this.store;
    }

    get accounts() {
        return this.store?.accounts ?? {};
    }

    get selectedEmail() {
        return this.store?.selectedEmail ?? '';
    }

    initialize(): void {
        createBrowserPreferences(this.deps.defaults).match({
            Ok: (preferences) => {
                this.store = preferences;
            },
            Err: (error) => {
                this.deps.feedback(error.message);
            }
        });
    }

    async save(): Promise<void> {
        const preferences = this.store;
        if (this.connecting || this.deps.blocked() || !preferences) {
            if (!preferences)
                this.deps.feedback(
                    'Browser storage is unavailable. Enable it to save your credentials.'
                );

            return;
        }

        this.newEmail = this.newEmail.trim();
        this.newToken = this.newToken.trim();

        if (!NewAccountSchema.safeParse({ email: this.newEmail, token: this.newToken }).success) {
            this.deps.feedback('Enter your Google account email and an OAuth2 or AAS token.');

            return;
        }

        this.connecting = true;
        this.deps.feedback('');

        const email = this.newEmail;
        const verified = await validateAccount(email, this.newToken);

        this.connecting = false;

        const token = verified.match({
            Ok: (value) => value,
            Err: (error) => {
                this.deps.feedback(error.message);

                return null;
            }
        });
        if (token === null) return;

        const updated = { ...this.accounts, [email]: token };
        const saved = preferences.saveAccounts(updated, email);
        saved.match({
            Ok: () => {
                this.newEmail = '';
                this.newToken = '';
                this.adding = false;
            },
            Err: (error) => {
                this.deps.feedback(error.message);
            }
        });
    }

    select(email: string): void {
        if (this.deps.blocked() || !Object.hasOwn(this.accounts, email)) return;

        const saved = this.store?.selectAccount(email);
        if (!saved) return;

        saved.inspectErr((error) => {
            this.deps.feedback(error.message);
        });
    }

    remove(email: string): void {
        if (this.deps.blocked() || !Object.hasOwn(this.accounts, email)) return;

        const updated = { ...this.accounts };
        delete updated[email];

        const removed = this.store?.saveAccounts(updated, Object.keys(updated)[0] ?? '');
        if (!removed) return;

        removed.inspectErr((error) => {
            this.deps.feedback(error.message);
        });
    }
}
