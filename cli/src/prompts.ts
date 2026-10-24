import { confirm, isCancel, password, select, text, type Option } from '@clack/prompts';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { z } from 'zod';
import type { CliContext, CliError } from './context';

const CANCELLED = { code: 'CANCELLED', message: 'Cancelled.' } as const satisfies CliError;
const EndOfInputKeySchema = z.object({ ctrl: z.literal(true), name: z.literal('d') });

type PromptOptions = {
    input: CliContext['stdin'];
    output: CliContext['stderr'];
    signal: AbortSignal;
};

function answered<T>(value: T | symbol): Result<T, CliError> {
    if (isCancel(value) || typeof value === 'symbol') return Err(CANCELLED);

    return Ok(value);
}

/**
 * Prompts read the terminal and draw on stderr, keeping stdout for command output.
 * Clack leaves a prompt pending when Ctrl+D closes its line reader, so that key cancels it.
 */
async function prompt<T>(
    context: CliContext,
    show: (options: PromptOptions) => Promise<T | symbol>
): Promise<Result<T, CliError>> {
    const ended = new AbortController();
    const onKeypress = (_input: unknown, key: unknown) => {
        if (EndOfInputKeySchema.safeParse(key).success) ended.abort();
    };
    context.stdin.on('keypress', onKeypress);

    try {
        const value = await show({
            input: context.stdin,
            output: context.stderr,
            signal: AbortSignal.any([context.signal, ended.signal])
        });

        return answered<T>(value);
    } finally {
        context.stdin.removeListener('keypress', onKeypress);
    }
}

/** Without a terminal, explain which argument or flag supplies the missing value. */
function requireTerminal(context: CliContext, hint: string): Result<void, CliError> {
    if (context.interactive) return Ok(undefined);

    return Err({ code: 'INPUT_REQUIRED', message: hint } as const);
}

type LinePrompt = (
    options: PromptOptions & { message: string; validate: (input?: string) => string | undefined }
) => Promise<string | symbol>;

function askLine(
    context: CliContext,
    show: LinePrompt,
    message: string,
    hint: string,
    validate: (value: string) => string | undefined
): AsyncResult<string, CliError> {
    return requireTerminal(context, hint)
        .andThenAsync(() =>
            prompt<string>(context, (options) =>
                show({ ...options, message, validate: (input) => validate(input?.trim() ?? '') })
            )
        )
        .map((input) => input.trim());
}

export function askText(
    context: CliContext,
    message: string,
    hint: string,
    validate: (value: string) => string | undefined
): AsyncResult<string, CliError> {
    return askLine(context, text, message, hint, validate);
}

export function askSecret(
    context: CliContext,
    message: string,
    hint: string,
    validate: (value: string) => string | undefined
): AsyncResult<string, CliError> {
    return askLine(context, password, message, hint, validate);
}

/** Destructive commands need either a terminal to confirm at or an explicit flag. */
export function canConfirm(
    context: CliContext,
    message: string,
    skip = false
): Result<void, CliError> {
    if (skip) return Ok(undefined);

    return requireTerminal(context, `${message} Pass --yes to confirm.`);
}

export function askConfirmation(
    context: CliContext,
    message: string,
    skip = false
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        if (skip) return Ok(undefined);

        const terminal = canConfirm(context, message);
        if (terminal.isErr()) return terminal;

        const value = await prompt<boolean>(context, (options) =>
            confirm({ ...options, message, initialValue: false })
        );

        return value.andThen((accepted) => (accepted ? Ok(undefined) : Err(CANCELLED)));
    });
}

export function askChoice<T extends string>(
    context: CliContext,
    message: string,
    hint: string,
    choices: Option<T>[]
): AsyncResult<T, CliError> {
    return requireTerminal(context, hint).andThenAsync(() =>
        prompt<T>(context, (options) => select<T>({ ...options, message, options: choices }))
    );
}
