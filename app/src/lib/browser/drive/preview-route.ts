import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { downloadRoute, type RouteMember } from '@madkarmaa/phodrive-core/groups';
import { Err, Ok, type Result } from 'results-ts';

type PreviewRouteDeps = {
    account: () => { email: string; token: string | undefined };
    groupMode: () => boolean;
    routeMembers: () => readonly RouteMember[];
};

export function previewRoute(
    item: FileGroup,
    deps: PreviewRouteDeps
): Result<string, ApplicationError> {
    if (deps.groupMode())
        return downloadRoute(item, deps.routeMembers()).map((route) => route.token);

    const { email, token } = deps.account();
    if (item.email !== email || !token)
        return Err({
            code: 'REQUEST_FAILED',
            message: 'Select the connected account for this file before previewing it.'
        } as const);

    return Ok(token);
}
