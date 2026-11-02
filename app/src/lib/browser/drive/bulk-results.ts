export type BulkFailure = { email: string; name: string; message: string };

const PAST_TENSE = {
    download: 'Downloaded',
    move: 'Moved',
    delete: 'Deleted',
    restore: 'Restored'
} as const;

export type BulkAction = keyof typeof PAST_TENSE;

const STALE_SELECTION_MESSAGE =
    'This selection no longer matches your library. Refresh and try again.';
const STALE_FAILURES = new Set([
    'invalid file metadata',
    'this file is no longer in the library. refresh and try again',
    'this file changed while you were confirming. refresh and try again',
    'this folder no longer exists. refresh and try again'
]);
const EXAMPLE_LIMIT = 3;
const GROUP_LIMIT = 3;
const COUNT_FORMAT = new Intl.NumberFormat('en-US');

type FailureGroup = { email: string; message: string; names: string[] };

function formatCount(value: number): string {
    return COUNT_FORMAT.format(value);
}

function groupFailures(failures: readonly BulkFailure[]): FailureGroup[] {
    const groups = new Map<string, FailureGroup>();

    for (const failure of failures) {
        const key = `${failure.message}\u0000${failure.email}`;
        const group = groups.get(key);
        if (group) group.names.push(failure.name);
        else
            groups.set(key, {
                email: failure.email,
                message: failure.message,
                names: [failure.name]
            });
    }

    return [...groups.values()].toSorted(
        (first, second) =>
            second.names.length - first.names.length ||
            first.message.localeCompare(second.message) ||
            first.email.localeCompare(second.email)
    );
}

function formatNames(names: readonly string[]): string {
    const examples = names.slice(0, EXAMPLE_LIMIT);
    const hidden = names.length - examples.length;
    const suffix = hidden > 0 ? ` and ${formatCount(hidden)} more` : '';

    return `${examples.join(', ')}${suffix}`;
}

function formatGroup(group: FailureGroup): string {
    const count = group.names.length;
    const subject = count === 1 ? 'failure' : 'failures';

    return `${formatCount(count)} ${subject} with "${group.message}" from ${group.email}: ${formatNames(group.names)}.`;
}

function isStaleFailure(failure: BulkFailure): boolean {
    const message = failure.message
        .trim()
        .toLowerCase()
        .replace(/[.!]+$/, '');

    return STALE_FAILURES.has(message);
}

export function bulkFailureMessage(
    failures: readonly BulkFailure[],
    total: number,
    action: BulkAction
): string {
    if (failures.length === 0) return '';
    if (failures.length === total && failures.every(isStaleFailure)) return STALE_SELECTION_MESSAGE;

    const changed = total - failures.length;
    const summary =
        changed === 0
            ? `Could not ${action} any files.`
            : `${PAST_TENSE[action]} ${formatCount(changed)} of ${formatCount(total)} files. ${formatCount(failures.length)} failed.`;
    const groups = groupFailures(failures);
    const details = groups.slice(0, GROUP_LIMIT).map(formatGroup);
    const hiddenFailures = groups
        .slice(GROUP_LIMIT)
        .reduce((count, group) => count + group.names.length, 0);
    if (hiddenFailures > 0)
        details.push(
            `And ${formatCount(hiddenFailures)} more ${hiddenFailures === 1 ? 'failure' : 'failures'}.`
        );

    return `${summary} ${details.join(' ')}`;
}
