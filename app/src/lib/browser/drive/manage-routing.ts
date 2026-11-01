import type { EntryTarget } from '#browser/drive/menu-types';
import type { Failure, ManageDeps, Route } from '#browser/drive/manage-types';
import { ownerEmails } from '#browser/drive/manage-files';

export function routesFor(target: EntryTarget, deps: ManageDeps): Route[] {
    const owners = ownerEmails(deps.files(), target);

    if (!deps.groupMode()) {
        const account = deps.account();
        const wrongOwner = owners.some(
            (email) => email.toLowerCase() !== account.email.toLowerCase()
        );
        if (wrongOwner)
            return owners.map((email) => ({
                email,
                message: `Switch to ${email} before changing these files.`
            }));
        if (!account.email || !account.token)
            return owners.map((email) => ({
                email,
                message: 'Select a connected account before continuing.'
            }));

        return [{ email: account.email, token: account.token }];
    }

    const members = deps.routeMembers();

    return owners.map((email) => {
        const member = members.find(
            (current) => current.email.toLowerCase() === email.toLowerCase()
        );

        return member
            ? { email: member.email, token: member.token }
            : { email, message: `${email} is not connected.` };
    });
}

export function failureMessage(failures: readonly Failure[], total: number): string {
    if (total === 1) return failures[0]?.message ?? 'The change failed.';

    const changed = total - failures.length;

    return `Changed ${changed} of ${total} accounts. ${failures
        .map((failure) => `${failure.email}: ${failure.message}`)
        .join(' ')}`;
}
