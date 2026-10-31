import { randomUUID } from 'node:crypto';
import type { Command } from '@commander-js/extra-typings';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { GroupNameSchema } from '@madkarmaa/phodrive-core/models';
import { readConfig, updateConfig } from '../config';
import type { CliContext, CliError } from '../context';
import { connectedAccount, findGroup, withGroups } from '../groups';
import { printJson, printTable, status } from '../output';
import type { Runner } from '../program';

function invalidOption(message: string): Result<never, CliError> {
    return Err({ code: 'INVALID_OPTION', message } as const);
}

function groupName(raw: string): Result<string, CliError> {
    const parsed = GroupNameSchema.safeParse(raw);
    if (!parsed.success)
        return invalidOption(parsed.error.issues[0]?.message ?? 'Enter a group name.');

    return Ok(parsed.data);
}

function listGroups(context: CliContext, json = false): AsyncResult<void, CliError> {
    return readConfig(context.configPath).map((config) => {
        if (json) {
            printJson(context, config.groups);

            return;
        }
        if (!config.groups.length) {
            status(context).info('No groups. Run `phodrive group create` to make one.');

            return;
        }

        printTable(
            context,
            ['Name', 'Accounts'],
            config.groups
                .toSorted((first, second) => first.name.localeCompare(second.name))
                .map((group) => [group.name, group.accounts.join(', ')])
        );
    });
}

function createGroup(
    context: CliContext,
    rawName: string,
    rawAccounts: readonly string[]
): AsyncResult<void, CliError> {
    return groupName(rawName).andThenAsync(async (name) => {
        const requested = [...new Set(rawAccounts.map((email) => email.trim()).filter(Boolean))];
        if (!requested.length) return invalidOption('Name at least one account with --account.');

        const updated = await updateConfig(context.configPath, (config) => {
            if (config.groups.some((group) => group.name.toLowerCase() === name.toLowerCase()))
                return invalidOption(`A group named ${name} already exists.`);

            const accounts: string[] = [];
            for (const email of requested) {
                const saved = connectedAccount(config, email);
                if (!saved)
                    return Err({
                        code: 'ACCOUNT_NOT_FOUND',
                        message: `${email} is not connected. Run \`phodrive account add\`.`
                    } as const);

                if (!accounts.includes(saved.email)) accounts.push(saved.email);
            }

            return withGroups(config, [...config.groups, { id: randomUUID(), name, accounts }]);
        }).map(() => status(context).success(`Created group ${name}`));

        return updated;
    });
}

function addMember(context: CliContext, name: string, email: string): AsyncResult<void, CliError> {
    return updateConfig(context.configPath, (config) => {
        const found = findGroup(config, name);
        if (found.isErr()) return found;

        const group = found.unwrap();
        const saved = connectedAccount(config, email);
        if (!saved)
            return Err({
                code: 'ACCOUNT_NOT_FOUND',
                message: `${email} is not connected. Run \`phodrive account add\`.`
            } as const);
        if (group.accounts.some((account) => account.toLowerCase() === saved.email.toLowerCase()))
            return invalidOption(`${saved.email} is already in ${group.name}.`);

        return withGroups(
            config,
            config.groups.map((current) =>
                current.id === group.id
                    ? { ...current, accounts: [...current.accounts, saved.email] }
                    : current
            )
        );
    }).map(() => status(context).success(`Added ${email} to ${name}`));
}

function removeMember(
    context: CliContext,
    name: string,
    email: string
): AsyncResult<void, CliError> {
    return updateConfig(context.configPath, (config) => {
        const found = findGroup(config, name);
        if (found.isErr()) return found;

        const group = found.unwrap();
        if (group.accounts.length === 1)
            return invalidOption(
                `${group.name} would be empty. Delete the group instead with \`phodrive group delete\`.`
            );

        const wanted = email.toLowerCase();
        const accounts = group.accounts.filter((account) => account.toLowerCase() !== wanted);
        if (accounts.length === group.accounts.length)
            return invalidOption(`${email} is not in ${group.name}.`);

        return withGroups(
            config,
            config.groups.map((current) =>
                current.id === group.id ? { ...current, accounts } : current
            )
        );
    }).map(() => {
        status(context).success(`Removed ${email} from ${name}`);
        status(context).warn('Files already uploaded stay with their owners.');
    });
}

function deleteGroup(context: CliContext, name: string): AsyncResult<void, CliError> {
    return updateConfig(context.configPath, (config) => {
        const found = findGroup(config, name);
        if (found.isErr()) return found;

        const group = found.unwrap();

        return withGroups(
            config,
            config.groups.filter((current) => current.id !== group.id)
        );
    }).map(() => {
        status(context).success(`Deleted group ${name}`);
        status(context).warn('Files already uploaded stay with their owners.');
    });
}

export function registerGroupCommands(program: Command, context: CliContext, run: Runner) {
    const group = program.command('group').description('Manage named groups of accounts');

    group
        .command('list')
        .description('List groups and their accounts')
        .option('--json', 'print JSON')
        .action((options) => run(() => listGroups(context, options.json)));

    group
        .command('create')
        .description('Create a group from connected accounts')
        .argument('<name>', 'group name')
        .option(
            '--account <email>',
            'account to include; repeat the flag',
            (value, previous) => [...previous, value],
            [] as string[]
        )
        .action((name, options) => run(() => createGroup(context, name, options.account)));

    group
        .command('add')
        .description('Add a connected account to a group')
        .argument('<name>', 'group name')
        .argument('<email>', 'connected account email')
        .action((name, email) => run(() => addMember(context, name, email)));

    group
        .command('remove')
        .description('Remove an account from a group without moving its files')
        .argument('<name>', 'group name')
        .argument('<email>', 'account in the group')
        .action((name, email) => run(() => removeMember(context, name, email)));

    group
        .command('delete')
        .description('Delete a group; uploaded files stay with their owners')
        .argument('<name>', 'group name')
        .action((name) => run(() => deleteGroup(context, name)));
}
