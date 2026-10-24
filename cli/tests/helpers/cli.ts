import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { CommanderError } from '@commander-js/extra-typings';
import { groupChunks, type FileGroup } from '@madkarmaa/phodrive-core/files';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import type { CliContext, CliError } from '../../src/context';
import { createProgram } from '../../src/program';

export const EMAIL = 'test@example.com';
export const AAS_TOKEN = 'aas_et/test';

export async function temporaryFolder() {
    const path = await mkdtemp(join(tmpdir(), 'phodrive-cli-'));

    return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

function capture() {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));

    return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

export async function runCli(
    args: string[],
    options: {
        folder: string;
        input?: string;
        environment?: Record<string, string>;
        signal?: AbortSignal;
    }
) {
    const stdout = capture();
    const stderr = capture();
    const stdin =
        options.input === undefined
            ? Object.assign(new PassThrough(), { isTTY: true })
            : Object.assign(Readable.from([options.input]), { isTTY: false });
    const context: CliContext = {
        configPath: join(options.folder, 'config', 'config.json'),
        environment: options.environment ?? {},
        cwd: options.folder,
        stdin,
        stdout: stdout.stream,
        stderr: stderr.stream,
        interactive: false,
        signal: options.signal ?? new AbortController().signal
    };
    const failures: CliError[] = [];
    let exitCode = 0;

    try {
        await createProgram(context, (error) => failures.push(error)).parseAsync(args, {
            from: 'user'
        });
    } catch (error) {
        if (!(error instanceof CommanderError)) throw error;

        exitCode = error.exitCode;
    }

    return {
        stdout: stdout.text(),
        stderr: stderr.text(),
        failures,
        exitCode: failures.length ? 1 : exitCode,
        configPath: context.configPath
    };
}

let sequence = 0;

/** A complete single-chunk file as the library returns it. */
export function remoteFile(name: string, at = 1_700_000_000_000, size = 1024): FileGroup {
    sequence++;
    const hex = sequence.toString(16).padStart(2, '0');
    const chunk: RemoteBmp = {
        fileHash: hex.repeat(32),
        fileId: `${hex}${'a'.repeat(62)}`,
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        size,
        at,
        mediaKey: `media-${sequence}`,
        sha1: hex.repeat(20)
    };

    return groupChunks([{ ...chunk, email: EMAIL }])[0];
}
