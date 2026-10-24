import type { ApplicationError } from '../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { AccountConnectionSchema } from '../models';
import { schemaResult } from '../validation';
import { apiJson } from './api';

const ACCOUNT_API_URL = '/api/accounts';
const CONNECTION_ERROR = 'Google could not validate this account. Try again.';

export function validateAccount(
    email: string,
    token: string
): AsyncResult<string, ApplicationError> {
    return apiJson(
        ACCOUNT_API_URL,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, token })
        },
        CONNECTION_ERROR
    )
        .andThen((body) => schemaResult(AccountConnectionSchema, body, CONNECTION_ERROR))
        .andThen((response) =>
            'error' in response
                ? Err({ code: 'ACCOUNT_CONNECTION_FAILED', message: response.error } as const)
                : Ok(response.token)
        );
}
