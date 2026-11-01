import type { EntryTarget } from '#browser/drive/menu-types';
import type { Failure, ManageAction, ManageDeps } from '#browser/drive/manage-types';
import { failureMessage, routesFor } from '#browser/drive/manage-routing';

export type RunOutcome = { ok: boolean; message: string };

export async function runManage(
    target: EntryTarget,
    deps: ManageDeps,
    action: ManageAction
): Promise<RunOutcome> {
    const routes = routesFor(target, deps);
    if (routes.length === 0) return { ok: false, message: 'There is nothing to change here.' };

    const failures: Failure[] = [];
    for (const route of routes) {
        if ('message' in route) {
            failures.push({ email: route.email, message: route.message });

            continue;
        }

        const result = await action(route.email, route.token);
        result.match({
            Ok: (response) => {
                deps.applyItems(route.email, response.items, response.revision);
                if (response.failed?.length)
                    failures.push({
                        email: route.email,
                        message: response.failed
                            .map((failure) => `${failure.name}: ${failure.message}`)
                            .join(' ')
                    });
            },
            Err: (error) => {
                failures.push({ email: route.email, message: error.message });
            }
        });
    }

    return failures.length === 0
        ? { ok: true, message: '' }
        : { ok: false, message: failureMessage(failures, routes.length) };
}
