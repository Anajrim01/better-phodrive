import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { partitionFileGroups } from '@madkarmaa/phodrive-core/trash';
import {
    GroupsSchema,
    mergeGroupLibrary,
    type GroupAccountState,
    type GroupPage,
    type RouteMember
} from '@madkarmaa/phodrive-core/groups';
import type { Group, RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { SERVER_ERRORS, type ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { throttleWaitSeconds } from '@madkarmaa/phodrive-core/server/photos/throttle';
import type { CliConfig } from './config';
import type { CliError } from './context';

export type GroupAccount = {
    email: string;
    token: string;
    paused: boolean;
};

export type GroupLibraryView = {
    files: FileGroup[];
    members: RouteMember[];
    accounts: GroupAccountState[];
};

export function connectedAccount(
    config: CliConfig,
    email: string
): { email: string; token: string } | undefined {
    const wanted = email.toLowerCase();
    const saved = Object.keys(config.accounts).find(
        (candidate) => candidate.toLowerCase() === wanted
    );
    if (!saved) return undefined;

    return { email: saved, token: config.accounts[saved] };
}

export function findGroup(config: CliConfig, name: string): Result<Group, CliError> {
    const wanted = name.trim().toLowerCase();
    const matches = config.groups.filter((group) => group.name.toLowerCase() === wanted);
    const [only] = matches;
    if (matches.length > 1)
        return Err({
            code: 'INVALID_OPTION',
            message: `More than one group is named ${name}. Delete one with \`phodrive group delete\`.`
        } as const);
    if (only) return Ok(only);

    return Err({
        code: 'GROUP_NOT_FOUND',
        message: `No group is named ${name}. Run \`phodrive group list\`.`
    } as const);
}

export function groupUploadAccounts(
    config: CliConfig,
    group: Group
): Result<GroupAccount[], CliError> {
    const members: GroupAccount[] = [];

    for (const email of group.accounts) {
        const saved = connectedAccount(config, email);
        if (!saved)
            return Err({
                code: 'ACCOUNT_NOT_FOUND',
                message: `${email} is in this group but is not connected. Run \`phodrive account add\`.`
            } as const);

        members.push({
            email: saved.email,
            token: saved.token,
            paused: throttleWaitSeconds(saved.email) !== null
        });
    }

    return Ok(members);
}

export function withGroups(config: CliConfig, groups: Group[]): Result<CliConfig, CliError> {
    const parsed = GroupsSchema.safeParse(groups);
    if (!parsed.success)
        return Err({
            code: 'INVALID_OPTION',
            message: parsed.error.issues[0]?.message ?? 'Invalid group.'
        } as const);

    return Ok({ ...config, groups: parsed.data });
}

function collectAccount(email: string, token: string): AsyncResult<RemoteBmp[], ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
        const pageTokens = new Set<string>();
        let pageToken = '';

        do {
            pageTokens.add(pageToken);

            const received = await listBmps(email, token, pageToken);
            if (received.isErr()) return received;

            const page = received.unwrap();
            if (page.nextPageToken && pageTokens.has(page.nextPageToken))
                return Err(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);

            for (const item of page.items) items.set(item.mediaKey, item);
            pageToken = page.nextPageToken;
        } while (pageToken);

        return Ok([...items.values()]);
    });
}

export function readGroupLibrary(
    config: CliConfig,
    group: Group
): AsyncResult<GroupLibraryView, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        const pages: GroupPage[] = [];

        for (const email of group.accounts) {
            const saved = connectedAccount(config, email);
            if (!saved) {
                pages.push({
                    email,
                    error: { code: 'ACCOUNT_NOT_FOUND', message: `${email} is not connected.` }
                });

                continue;
            }

            const listed = await collectAccount(saved.email, saved.token);
            if (listed.isErr()) pages.push({ email: saved.email, error: listed.unwrapErr() });
            else pages.push({ email: saved.email, items: listed.unwrap() });
        }

        const merged = mergeGroupLibrary(pages);
        const states = new Map(merged.accounts.map((state) => [state.email.toLowerCase(), state]));
        const members: RouteMember[] = [];

        for (const email of group.accounts) {
            const saved = connectedAccount(config, email);
            if (!saved) continue;

            members.push({
                email: saved.email,
                token: saved.token,
                paused: states.get(saved.email.toLowerCase())?.status === 'paused'
            });
        }

        return Ok({
            files: partitionFileGroups(merged.items).files,
            members,
            accounts: merged.accounts
        });
    });
}
