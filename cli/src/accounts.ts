import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { readConfig, type CliConfig } from './config';
import type { CliContext, CliError } from './context';

export type Session = { email: string; token: string; config: CliConfig };

/** Email addresses match regardless of case, returning the address as it was saved. */
export function findAccount(config: CliConfig, email: string): string | undefined {
    const wanted = email.trim().toLowerCase();

    return Object.keys(config.accounts).find((saved) => saved.toLowerCase() === wanted);
}

/** The chosen account, falling back to the saved selection and then the first account. */
export function selectedEmail(config: CliConfig): string {
    if (Object.hasOwn(config.accounts, config.selected)) return config.selected;

    return Object.keys(config.accounts)[0] ?? '';
}

/** Resolve a requested account, or the selected one, to its saved address. */
export function requireAccount(config: CliConfig, email?: string): Result<string, CliError> {
    const requested = email?.trim() || selectedEmail(config);
    if (!requested)
        return Err({
            code: 'ACCOUNT_REQUIRED',
            message: 'No account is connected. Run `phodrive account add` first.'
        } as const);

    const saved = findAccount(config, requested);
    if (saved) return Ok(saved);

    return Err({
        code: 'ACCOUNT_NOT_FOUND',
        message: `${requested} is not connected. Run \`phodrive account list\` to see accounts.`
    } as const);
}

export function openSession(context: CliContext, account?: string): AsyncResult<Session, CliError> {
    return readConfig(context.configPath).andThen((config) =>
        requireAccount(config, account).map((email) => ({
            email,
            token: config.accounts[email],
            config
        }))
    );
}

/** Adding an address again, in any letter case, replaces its saved token and selects it. */
export function withAccount(config: CliConfig, email: string, token: string): CliConfig {
    const accounts = { ...config.accounts };
    const previous = findAccount(config, email);
    if (previous) delete accounts[previous];

    return { ...config, accounts: { ...accounts, [email]: token }, selected: email };
}

/** Removing the selected account selects the first remaining one. */
export function withoutAccount(config: CliConfig, email: string): CliConfig {
    const accounts = { ...config.accounts };
    delete accounts[email];

    const selected = config.selected === email ? (Object.keys(accounts)[0] ?? '') : config.selected;

    return { ...config, accounts, selected };
}
