import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { authenticatedHeaders } from '@madkarmaa/phodrive-core/server/photos/auth';
import {
    classifyMutationFailure,
    type OwnerRpc
} from '@madkarmaa/phodrive-core/server/photos/shares/google-rpc';
import type { ThrottleScope } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { saveLedger, type Ledger, type LedgerError, type Step } from './ledger.ts';

export type SpikeError =
    | ServerError
    | LedgerError
    | { readonly code: 'CREDENTIALS_INVALID' | 'LINK_NOT_LIVE' | 'FIXTURE_PREEXISTS' };

/** Output allowlist: stage, status, count, hash and host are the only fields ever written. */
export type ReportLine = {
    stage: string;
    status: string;
    count?: number;
    hash?: string;
    host?: string;
};

export type SpikeContext = {
    fetcher: Fetcher;
    report: (line: ReportLine) => void;
    sleep: (milliseconds: number) => Promise<void>;
};

export type SpikeSession = SpikeContext & { path: string; ledger: Ledger };

export type OwnerSession = SpikeSession & {
    account: { email: string; token: string };
    scope: ThrottleScope;
};

type MutationStep<T> = {
    stage: string;
    hash?: string;
    /** The state a 404 or 410 means: gone is success for a removal, a refusal for a creation. */
    gone: Extract<Step, 'ok' | 'rejected'>;
    set: (step: Step) => void;
    call: () => AsyncResult<T, ServerError>;
    apply: (value: T) => void;
};

export function failureStatus(error: SpikeError): string {
    return error.code === 'REQUEST_FAILED' && error.status !== undefined
        ? `${error.code}:${error.status}`
        : error.code;
}

export function asyncOk(): AsyncResult<void, SpikeError> {
    return Ok(undefined).andThenAsync<void, SpikeError>(async () => Ok(undefined));
}

export function inOrder<T>(
    items: readonly T[],
    run: (item: T) => AsyncResult<void, SpikeError>
): AsyncResult<void, SpikeError> {
    return items.reduce((previous, item) => previous.andThenAsync(() => run(item)), asyncOk());
}

export function persist(session: SpikeSession): AsyncResult<void, SpikeError> {
    return saveLedger(session.path, session.ledger);
}

export function authenticate(owner: OwnerSession): AsyncResult<OwnerRpc, SpikeError> {
    const { fetcher, scope, account } = owner;

    return authenticatedHeaders(account.email, account.token, fetcher, scope)
        .map(({ rpcHeaders }) => ({ rpcHeaders, fetcher, scope }))
        .inspect(() => owner.report({ stage: 'auth', status: 'ok' }))
        .inspectErr((error) => owner.report({ stage: 'auth', status: failureStatus(error) }));
}

/** Records intent before the one RPC attempt. A failure is recorded and never retried here. */
export function mutationStep<T>(
    session: SpikeSession,
    step: MutationStep<T>
): AsyncResult<void, SpikeError> {
    const { stage, hash } = step;
    step.set('pending');

    return persist(session).andThenAsync(async () => {
        const result = await step.call();

        return result.match<AsyncResult<void, SpikeError>>({
            Ok: (value) => {
                step.set('ok');
                step.apply(value);
                session.report({ stage, status: 'ok', ...(hash ? { hash } : {}) });

                return persist(session);
            },
            Err: (error) => {
                const failure = classifyMutationFailure(error);
                const state = failure === 'gone' ? step.gone : failure;
                step.set(state);
                session.report({ stage, status: `${state}:${failureStatus(error)}` });

                return persist(session).andThen(() =>
                    state === 'ok' ? Ok(undefined) : Err(error)
                );
            }
        });
    });
}
