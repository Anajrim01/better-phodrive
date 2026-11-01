#!/usr/bin/env node
import process from 'node:process';
import { dirname, join } from 'node:path';
import { isCI } from '@clack/prompts';
import { CommanderError } from '@commander-js/extra-typings';
import { defaultConfigPath } from './config';
import type { CliContext, CliError } from './context';
import { createProgram } from './program';
import { RELEASE_ASSET } from './update';
import {
    configureProbeCache,
    flushProbeCache
} from '@madkarmaa/phodrive-core/server/photos/library';

const INTERRUPTED_EXIT_CODE = 130;

const abort = new AbortController();
let interrupted = false;

// The first interrupt cancels transfers and cleans up partial files; a second one exits at once.
process.on('SIGINT', () => {
    if (interrupted) process.exit(INTERRUPTED_EXIT_CODE);

    interrupted = true;
    abort.abort();
});

const context: CliContext = {
    configPath: defaultConfigPath(process.env),
    environment: process.env,
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY) && !isCI(),
    signal: abort.signal,
    release: RELEASE_ASSET ? { executable: process.execPath, asset: RELEASE_ASSET } : null
};

configureProbeCache(join(dirname(context.configPath), 'probe-cache.json'));
process.on('exit', flushProbeCache);

const failures: CliError[] = [];
const program = createProgram(context, (error) => failures.push(error));

try {
    await program.parseAsync(process.argv);
} catch (error) {
    // Commander reports usage errors, help, and the version by throwing after printing them.
    if (!(error instanceof CommanderError)) throw error;

    process.exitCode = error.exitCode;
}

const cancelled = interrupted || failures.some((failure) => failure.code === 'CANCELLED');
if (failures.length) process.exitCode = cancelled ? INTERRUPTED_EXIT_CODE : 1;
