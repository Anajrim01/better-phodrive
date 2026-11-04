import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { apiJson } from '@madkarmaa/phodrive-core/browser/api';
import {
    GoogleAccountGroupSchema,
    GoogleAccountSummarySchema,
    type GoogleAccountGroup,
    type GoogleAccountSummary
} from '@madkarmaa/phodrive-core/models';
import type { AsyncResult } from 'results-ts';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import { z } from 'zod';
import { encryptToken } from '#browser/auth';

const GOOGLE_ACCOUNT_URL = '/api/account/google';
const GOOGLE_GROUP_URL = '/api/account/groups';
const ACCOUNTS_FAILED = 'Could not load your Google accounts. Try again.';
const GROUPS_FAILED = 'Could not load your groups. Try again.';
const ACCOUNT_SAVE_FAILED = 'Google could not validate this account. Try again.';
const GROUP_SAVE_FAILED = 'Could not save the group. Try again.';
const GROUP_MEMBER_FAILED = 'Could not update the group members. Try again.';

const AccountsResponseSchema = z.object({ accounts: z.array(GoogleAccountSummarySchema) });
const AccountResponseSchema = z.object({ account: GoogleAccountSummarySchema });
const GroupsResponseSchema = z.object({ groups: z.array(GoogleAccountGroupSchema) });
const GroupResponseSchema = z.object({ group: GoogleAccountGroupSchema });

export function listGoogleAccounts(): AsyncResult<GoogleAccountSummary[], ApplicationError> {
    return apiJson(GOOGLE_ACCOUNT_URL, { method: 'GET' }, ACCOUNTS_FAILED).andThen((body) =>
        schemaResult(AccountsResponseSchema, body, ACCOUNTS_FAILED).map((data) => data.accounts)
    );
}

/** Add a Google account, or refresh the token if that email is already connected. */
export function addGoogleAccount(
    email: string,
    token: string
): AsyncResult<void, ApplicationError> {
    return encryptToken(token).andThenAsync((encryptedToken) =>
        apiJson(
            GOOGLE_ACCOUNT_URL,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, encryptedToken })
            },
            ACCOUNT_SAVE_FAILED
        )
            .andThen((body) => schemaResult(AccountResponseSchema, body, ACCOUNT_SAVE_FAILED))
            .map(() => undefined)
    );
}

/** Replace one account's token; the server validates it before storing it under the same id. */
export function replaceGoogleAccountToken(
    accountId: string,
    token: string
): AsyncResult<void, ApplicationError> {
    return encryptToken(token).andThenAsync((encryptedToken) =>
        apiJson(
            `${GOOGLE_ACCOUNT_URL}/${encodeURIComponent(accountId)}`,
            {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ encryptedToken })
            },
            ACCOUNT_SAVE_FAILED
        )
            .andThen((body) => schemaResult(AccountResponseSchema, body, ACCOUNT_SAVE_FAILED))
            .map(() => undefined)
    );
}

export function removeGoogleAccount(accountId: string): AsyncResult<void, ApplicationError> {
    return apiJson(
        `${GOOGLE_ACCOUNT_URL}/${encodeURIComponent(accountId)}`,
        { method: 'DELETE' },
        ACCOUNT_SAVE_FAILED
    ).map(() => undefined);
}

export function listGoogleGroups(): AsyncResult<GoogleAccountGroup[], ApplicationError> {
    return apiJson(GOOGLE_GROUP_URL, { method: 'GET' }, GROUPS_FAILED).andThen((body) =>
        schemaResult(GroupsResponseSchema, body, GROUPS_FAILED).map((data) => data.groups)
    );
}

export function createGoogleGroup(name: string): AsyncResult<void, ApplicationError> {
    return apiJson(
        GOOGLE_GROUP_URL,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name })
        },
        GROUP_SAVE_FAILED
    )
        .andThen((body) => schemaResult(GroupResponseSchema, body, GROUP_SAVE_FAILED))
        .map(() => undefined);
}

export function deleteGoogleGroup(groupId: string): AsyncResult<void, ApplicationError> {
    return apiJson(
        `${GOOGLE_GROUP_URL}/${encodeURIComponent(groupId)}`,
        { method: 'DELETE' },
        GROUP_SAVE_FAILED
    ).map(() => undefined);
}

export function addGoogleGroupMember(
    groupId: string,
    accountId: string
): AsyncResult<void, ApplicationError> {
    return apiJson(
        `${GOOGLE_GROUP_URL}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(accountId)}`,
        { method: 'PUT' },
        GROUP_MEMBER_FAILED
    )
        .andThen((body) => schemaResult(GroupResponseSchema, body, GROUP_MEMBER_FAILED))
        .map(() => undefined);
}

export function removeGoogleGroupMember(
    groupId: string,
    accountId: string
): AsyncResult<void, ApplicationError> {
    return apiJson(
        `${GOOGLE_GROUP_URL}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(accountId)}`,
        { method: 'DELETE' },
        GROUP_MEMBER_FAILED
    )
        .andThen((body) => schemaResult(GroupResponseSchema, body, GROUP_MEMBER_FAILED))
        .map(() => undefined);
}
