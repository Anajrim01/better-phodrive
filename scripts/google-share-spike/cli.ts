import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { AccountSchema } from '@madkarmaa/phodrive-core/models';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { runCleanup } from './cleanup.ts';
import { runCreate } from './create.ts';
import { accountHash, loadLedger } from './ledger.ts';
import { runProbe } from './probe.ts';
import {
    failureStatus,
    type OwnerSession,
    type ReportLine,
    type SpikeContext,
    type SpikeError,
    type SpikeSession
} from './steps.ts';
import { runRevoke } from './teardown.ts';

const DEFAULT_FIXTURE_COUNT = 3;

export const USAGE = `Usage: google-share-spike <command> --ledger <file> [--credentials <file>] [--count <n>]

  create   Upload tiny fixtures and share them. Refuses an existing ledger.
  probe    Read the public listing and media without owner credentials.
  revoke   Disable the link, delete the envelope and album, then observe public URLs.
  cleanup  Revoke, then delete only the media this ledger owns.

create --count must be a positive safe integer; the default is 3 fixtures.
Each fixture is about 3126 bytes plus upload RPCs. Choose the count for your diagnostic resource budget.

Keep both files private and outside the repository. The ledger holds live share capabilities.
The credentials file is JSON: {"email": "...", "token": "..."}. create, revoke and cleanup need it.`;

export type SpikeDeps = {
    fetcher: Fetcher;
    write: (line: string) => void;
    sleep: (milliseconds: number) => Promise<void>;
};

type Account = OwnerSession['account'];

function readCredentials(path: string): AsyncResult<Account, SpikeError> {
    return Ok(undefined).andThenAsync<Account, SpikeError>(async () => {
        try {
            const parsed = AccountSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));

            return parsed.success ? Ok(parsed.data) : Err({ code: 'CREDENTIALS_INVALID' });
        } catch {
            return Err({ code: 'CREDENTIALS_INVALID' });
        }
    });
}

function ownerScope(context: SpikeContext, account: Account): OwnerSession['scope'] {
    return {
        key: account.email,
        coordinator: createThrottleCoordinator(),
        onWait: (seconds) =>
            context.report({ stage: 'throttle', status: 'waiting', count: seconds })
    };
}

function withOwner(
    context: SpikeContext,
    ledgerPath: string,
    credentialsPath: string,
    run: (owner: OwnerSession) => AsyncResult<number, SpikeError>
): AsyncResult<number, SpikeError> {
    return readCredentials(credentialsPath).andThenAsync((account) =>
        loadLedger(ledgerPath).andThenAsync(async (ledger) => {
            if (ledger.accountHash !== accountHash(account.email))
                return Err({ code: 'LEDGER_ACCOUNT_MISMATCH' } as const);

            const scope = ownerScope(context, account);

            return run({ ...context, path: ledgerPath, ledger, account, scope });
        })
    );
}

function dispatch(
    command: string,
    context: SpikeContext,
    ledgerPath: string,
    credentialsPath: string,
    count: number
): AsyncResult<number, SpikeError> {
    if (command === 'probe')
        return loadLedger(ledgerPath).andThenAsync((ledger) => {
            const session: SpikeSession = { ...context, path: ledgerPath, ledger };

            return runProbe(session);
        });

    if (command === 'create')
        return readCredentials(credentialsPath).andThenAsync((account) =>
            runCreate(context, ledgerPath, account, ownerScope(context, account), count).map(
                () => 0
            )
        );

    return withOwner(
        context,
        ledgerPath,
        credentialsPath,
        command === 'revoke' ? runRevoke : runCleanup
    );
}

function parseCommand(argv: readonly string[]): {
    command?: string;
    ledger?: string;
    credentials?: string;
    count?: string;
} {
    try {
        const { values, positionals } = parseArgs({
            args: [...argv],
            allowPositionals: true,
            options: {
                ledger: { type: 'string' },
                credentials: { type: 'string' },
                count: { type: 'string' }
            }
        });

        return { command: positionals[0], ...values };
    } catch {
        return {};
    }
}

export async function runSpike(argv: readonly string[], deps: SpikeDeps): Promise<number> {
    const { command, ledger, credentials, count } = parseCommand(argv);
    const fixtureCount = count === undefined ? DEFAULT_FIXTURE_COUNT : Number(count);
    const known = command === 'create' || command === 'revoke' || command === 'cleanup';
    if (
        !ledger ||
        (known && !credentials) ||
        !(known || command === 'probe') ||
        (count !== undefined && command !== 'create') ||
        !Number.isSafeInteger(fixtureCount) ||
        fixtureCount <= 0
    ) {
        deps.write(USAGE);

        return 2;
    }

    const context: SpikeContext = {
        fetcher: deps.fetcher,
        sleep: deps.sleep,
        report: (line: ReportLine) => deps.write(JSON.stringify(line))
    };

    return dispatch(command ?? '', context, ledger, credentials ?? '', fixtureCount).match({
        Ok: (problems) => (problems ? 1 : 0),
        Err: (error) => {
            context.report({ stage: command ?? '', status: failureStatus(error) });

            return 1;
        }
    });
}
