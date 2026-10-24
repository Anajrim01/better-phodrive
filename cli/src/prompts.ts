import { confirm, isCancel, password, select, text, type Option } from '@clack/prompts';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { CliContext, CliError } from './context';

const CANCELLED = { code: 'CANCELLED', message: 'Cancelled.' } as const satisfies CliError;

/** Prompts read the terminal and draw on stderr, keeping stdout for command output. */
function promptOptions(context: CliContext) {
    return { input: context.stdin, output: context.stderr, signal: context.signal };
}

function answered<T>(value: T | symbol): Result<T, CliError> {
    if (isCancel(value) || typeof value === 'symbol') return Err(CANCELLED);

    return Ok(value);
}

/** Without a terminal, explain which argument or flag supplies the missing value. */
function requireTerminal(context: CliContext, hint: string): Result<void, CliError> {
    if (context.interactive) return Ok(undefined);

    return Err({ code: 'INPUT_REQUIRED', message: hint } as const);
}

export function askText(
    context: CliContext,
    message: string,
    hint: string,
    validate: (value: string) => string | undefined
): AsyncResult<string, CliError> {
    return requireTerminal(context, hint).andThenAsync(async () => {
        const value = await text({
            ...promptOptions(context),
            message,
            validate: (input) => validate(input?.trim() ?? '')
        });

        return answered<string>(value).map((input) => input.trim());
    });
}

export function askSecret(
    context: CliContext,
    message: string,
    hint: string,
    validate: (value: string) => string | undefined
): AsyncResult<string, CliError> {
    return requireTerminal(context, hint).andThenAsync(async () => {
        const value = await password({
            ...promptOptions(context),
            message,
            validate: (input) => validate(input?.trim() ?? '')
        });

        return answered<string>(value).map((input) => input.trim());
    });
}

/** Destructive commands need either a confirmation at the terminal or an explicit flag. */
export function askConfirmation(
    context: CliContext,
    message: string,
    skip: boolean
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        if (skip) return Ok(undefined);

        const terminal = requireTerminal(context, `${message} Pass --yes to confirm.`);
        if (terminal.isErr()) return terminal;

        const value = await confirm({ ...promptOptions(context), message, initialValue: false });

        return answered<boolean>(value).andThen((accepted) =>
            accepted ? Ok(undefined) : Err(CANCELLED)
        );
    });
}

export function askChoice<T extends string>(
    context: CliContext,
    message: string,
    hint: string,
    options: Option<T>[]
): AsyncResult<T, CliError> {
    return requireTerminal(context, hint).andThenAsync(async () => {
        const value = await select<T>({ ...promptOptions(context), message, options });

        return answered<T>(value);
    });
}
