import { log, progress, spinner } from '@clack/prompts';
import Table from 'cli-table3';
import prettyBytes from 'pretty-bytes';
import pc from 'picocolors';
import { fileType, type FileGroup } from '@madkarmaa/phodrive-core/files';
import type { CliContext, CliError } from './context';

/** Files are identified by this many leading characters of their ID in tables and arguments. */
export const SHORT_ID_LENGTH = 12;
export const FILE_TABLE_HEAD = ['ID', 'Name', 'Type', 'Size', 'Modified', ''];
const PROGRESS_STEPS = 1000;
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
// Google rejects expired or revoked tokens while authenticating each request.
const REJECTED_TOKEN_PATTERN = /^Authentication failed \(HTTP 40[13]\)/;

// Space-separated columns stay readable and easy to filter with standard text tools.
const BORDERLESS = {
    top: '',
    'top-mid': '',
    'top-left': '',
    'top-right': '',
    bottom: '',
    'bottom-mid': '',
    'bottom-left': '',
    'bottom-right': '',
    left: '',
    'left-mid': '',
    mid: '',
    'mid-mid': '',
    right: '',
    'right-mid': '',
    middle: '  '
};

/** JSON output is meant for files and pipes, so it runs without spinners or prompts. */
export function jsonContext(context: CliContext, json = false): CliContext {
    return json ? { ...context, interactive: false } : context;
}

export function printJson(context: CliContext, value: unknown): void {
    context.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printTable(context: CliContext, head: string[], rows: string[][]): void {
    const table = new Table({
        head: head.map((title) => pc.bold(title)),
        chars: BORDERLESS,
        style: { head: [], border: [], 'padding-left': 0, 'padding-right': 0 }
    });
    table.push(...rows);

    const lines = table
        .toString()
        .split('\n')
        .map((line) => line.trimEnd());
    context.stdout.write(`${lines.join('\n')}\n`);
}

/** Status lines go to stderr so piped command output stays clean. */
export function status(context: CliContext) {
    // Single-line statuses without the guide bar clack draws between prompts.
    const output = { output: context.stderr, spacing: 0 };

    return {
        info: (message: string) => log.info(message, output),
        success: (message: string) => log.success(message, output),
        warn: (message: string) => log.warn(message, output),
        error: (message: string) => log.error(message, output)
    };
}

export function reportError(context: CliContext, error: CliError): void {
    const rejected = error.code === 'REQUEST_FAILED' && REJECTED_TOKEN_PATTERN.test(error.message);
    const hint = rejected
        ? ' The saved token may be expired; run `phodrive account add` again.'
        : '';

    status(context).error(`${error.message}${hint}`);
}

/** A spinner at the terminal; scripts rely on output and exit codes instead. */
export function activity(context: CliContext, message: string) {
    if (!context.interactive) return { stop: () => {}, fail: () => {} };

    const indicator = spinner({ output: context.stderr });
    indicator.start(message);

    return {
        stop: (done: string) => indicator.stop(done),
        fail: () => indicator.clear()
    };
}

/** A byte progress bar at the terminal; scripts receive no intermediate output. */
export function transferProgress(context: CliContext, message: string, total: number) {
    if (!context.interactive) return { update: () => {}, stop: () => {}, fail: () => {} };

    const bar = progress({ output: context.stderr, max: PROGRESS_STEPS, style: 'heavy' });
    let shown = 0;
    bar.start(message);

    return {
        update: (completed: number, detail: string) => {
            const steps = total ? Math.floor((completed / total) * PROGRESS_STEPS) : 0;
            const advance = Math.min(steps, PROGRESS_STEPS) - shown;
            const percent = total ? Math.floor((completed / total) * 100) : 0;
            const label = `${detail} ${pc.dim(`${Math.min(percent, 100)}%`)}`;
            if (advance <= 0) {
                bar.message(label);

                return;
            }

            shown += advance;
            bar.advance(advance, label);
        },
        stop: (done: string) => bar.stop(done),
        fail: () => bar.clear()
    };
}

export function shortId(file: FileGroup): string {
    return file.fileId.slice(0, SHORT_ID_LENGTH);
}

export function fileSize(file: FileGroup): number {
    return file.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
}

export function fileRow(file: FileGroup): string[] {
    return [
        shortId(file),
        file.name,
        fileType(file.name),
        prettyBytes(fileSize(file)),
        DATE_FORMAT.format(file.at),
        file.complete ? '' : pc.yellow('incomplete')
    ];
}

/** Machine-readable files never include account credentials. */
export function fileJson(file: FileGroup) {
    return {
        id: file.fileId,
        name: file.name,
        type: fileType(file.name),
        size: fileSize(file),
        modified: new Date(file.at).toISOString(),
        complete: file.complete,
        chunks: file.chunks.length
    };
}
