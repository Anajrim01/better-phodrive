import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { Sha1HexSchema } from '../../models';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { photosFetch, type Fetcher } from '../fetcher';
import { bodyBytes, bytesField, message, numberField } from '../protobuf';
import { authenticatedHeaders } from './auth';
import { validateMutationResponse, type MutationKind } from './mutation-response';
export type { MutationKind } from './mutation-response';
import type { ThrottleScope } from './throttle';
import { guardedSend, readBody } from './transport';

export const MUTATION_BATCH_SIZE = 500;

const MUTATION_URL =
    'https://photosdata-pa.googleapis.com/6439526531001121323/17490284929287180316';

const STAGES: Record<MutationKind, string> = {
    trash: 'Move to trash',
    restore: 'Restore from trash',
    delete: 'Delete permanently'
};

const EMPTY = Buffer.alloc(0);

export type MutationTarget = { mediaKey: string; sha1: string };

export type MutationOutcome<T extends MutationTarget> = {
    applied: T[];
    failure?: ServerError;
};

function operation(kind: MutationKind): number {
    if (kind === 'trash') return 1;
    if (kind === 'restore') return 3;

    return 2;
}

function action(kind: MutationKind): number {
    return kind === 'trash' ? 1 : 2;
}

function details(kind: MutationKind): Buffer {
    const restore = message(bytesField(2, EMPTY), bytesField(3, bytesField(1, EMPTY)));

    return bytesField(
        4,
        kind === 'trash'
            ? message(
                  bytesField(2, EMPTY),
                  bytesField(3, bytesField(1, EMPTY)),
                  bytesField(4, EMPTY),
                  bytesField(5, bytesField(1, EMPTY))
              )
            : restore
    );
}

function clientContext(): Buffer {
    return message(
        numberField(1, 5),
        bytesField(2, message(numberField(1, 49029607), bytesField(2, '28')))
    );
}

function mutationBody(kind: MutationKind, sha1s: readonly string[]): Buffer {
    return message(
        numberField(2, operation(kind)),
        ...sha1s.map((sha1) => bytesField(3, Buffer.from(sha1, 'hex').toString('base64url'))),
        numberField(4, action(kind)),
        bytesField(8, details(kind)),
        bytesField(9, kind === 'delete' ? EMPTY : clientContext())
    );
}

function uniqueTargets<T extends MutationTarget>(targets: readonly T[]): Result<T[], ServerError> {
    if (!targets.length) return Err(SERVER_ERRORS.INVALID_FILE_REFERENCE);

    const seen = new Map<string, string>();
    const unique: T[] = [];

    for (const target of targets) {
        if (!target.mediaKey || !Sha1HexSchema.safeParse(target.sha1).success)
            return Err(SERVER_ERRORS.INVALID_FILE_REFERENCE);

        const previous = seen.get(target.mediaKey);
        if (previous !== undefined) {
            if (previous !== target.sha1) return Err(SERVER_ERRORS.INVALID_FILE_METADATA);
            continue;
        }

        seen.set(target.mediaKey, target.sha1);
        unique.push(target);
    }

    return Ok(unique);
}

/** Apply one bounded Photos mutation per batch. Every request uses the account's throttle scope. */
export function mutatePhotos<T extends MutationTarget>(
    kind: MutationKind,
    account: { email: string; token: string },
    targets: readonly T[],
    scope: ThrottleScope,
    fetcher: Fetcher = photosFetch,
    onApplied?: (applied: readonly T[]) => void | Promise<void>
): AsyncResult<MutationOutcome<T>, ServerError> {
    return uniqueTargets(targets).andThenAsync(
        (unique): AsyncResult<MutationOutcome<T>, ServerError> =>
            authenticatedHeaders(account.email, account.token, fetcher, scope).andThenAsync(
                async (headers): Promise<Result<MutationOutcome<T>, ServerError>> => {
                    const appliedKeys = new Set<string>();
                    let failure: ServerError | undefined;

                    for (let offset = 0; offset < unique.length; offset += MUTATION_BATCH_SIZE) {
                        if (scope.signal?.aborted) {
                            failure = SERVER_ERRORS.UPLOAD_CANCELLED;
                            break;
                        }

                        const batch = unique.slice(offset, offset + MUTATION_BATCH_SIZE);
                        const sent = await guardedSend(
                            scope,
                            fetcher,
                            MUTATION_URL,
                            {
                                method: 'POST',
                                redirect: 'manual',
                                headers: {
                                    ...headers.commonHeaders,
                                    'content-type': 'application/x-protobuf'
                                },
                                body: bodyBytes(
                                    mutationBody(
                                        kind,
                                        batch.map((target) => target.sha1)
                                    )
                                ),
                                ...(scope.signal ? { signal: scope.signal } : {})
                            },
                            STAGES[kind],
                            { preserveServerFailure: true }
                        );
                        if (sent.isErr()) {
                            failure = sent.unwrapErr();
                            break;
                        }

                        const body = await readBody(sent.unwrap(), STAGES[kind]);
                        if (body.isErr()) {
                            failure = body.unwrapErr();
                            break;
                        }

                        const receipt = validateMutationResponse(
                            kind,
                            body.unwrap(),
                            batch.map((target) => target.mediaKey)
                        );
                        if (receipt.isErr()) {
                            failure = receipt.unwrapErr();
                            break;
                        }

                        const confirmed = new Set(receipt.unwrap().applied);
                        const applied = batch.filter((target) => confirmed.has(target.mediaKey));
                        if (!applied.length) {
                            failure = SERVER_ERRORS.INVALID_MUTATION_RESPONSE;
                            break;
                        }

                        for (const target of applied) appliedKeys.add(target.mediaKey);

                        try {
                            await onApplied?.(applied);
                        } catch {
                            failure = SERVER_ERRORS.METADATA_UNAVAILABLE;
                        }

                        if (failure) break;
                        if (applied.length !== batch.length) {
                            failure = SERVER_ERRORS.MUTATION_PARTIAL;
                            break;
                        }
                    }

                    const applied = targets.filter((target) => appliedKeys.has(target.mediaKey));

                    return applied.length || !failure
                        ? Ok({ applied, ...(failure ? { failure } : {}) })
                        : Err(failure);
                }
            )
    );
}
