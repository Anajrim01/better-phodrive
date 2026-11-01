export type BulkFailure = { email: string; name: string; message: string };

const PAST_TENSE = {
    download: 'Downloaded',
    move: 'Moved',
    delete: 'Deleted',
    restore: 'Restored'
} as const;

export type BulkAction = keyof typeof PAST_TENSE;

export function bulkFailureMessage(
    failures: readonly BulkFailure[],
    total: number,
    action: BulkAction
): string {
    if (failures.length === 0) return '';

    const changed = total - failures.length;
    const summary =
        changed === 0
            ? `Could not ${action} any files.`
            : `${PAST_TENSE[action]} ${changed} of ${total} files.`;
    const owners = new Map<string, BulkFailure[]>();
    for (const failure of failures) {
        const current = owners.get(failure.email);
        if (current) current.push(failure);
        else owners.set(failure.email, [failure]);
    }

    const details = [...owners.entries()]
        .toSorted(([first], [second]) => first.localeCompare(second))
        .map(
            ([email, owned]) =>
                `${email}: ${owned.map((failure) => `${failure.name}: ${failure.message}`).join(' ')}`
        )
        .join(' ');

    return `${summary} ${details}`;
}
