export type AssignmentFile = {
    jobId: number;
    name: string;
    size: number;
};

export type AssignmentMember = {
    id: string;
};

export type UploadAssignment = {
    jobId: number;
    accountId: string | null;
};

/** Assign whole files to the least-loaded member, largest first, matching batch-local bytes. */
export function assignUploadOwners(
    files: readonly AssignmentFile[],
    members: readonly AssignmentMember[]
): UploadAssignment[] {
    if (!members.length) return files.map((file) => ({ jobId: file.jobId, accountId: null }));

    const loads = new Map(members.map((member) => [member.id, 0]));
    const orderedMembers = [...members].toSorted((first, second) =>
        first.id < second.id ? -1 : first.id > second.id ? 1 : 0
    );
    const owners = new Map<number, string>();
    const ordered = files.toSorted(
        (first, second) =>
            second.size - first.size ||
            (first.name < second.name ? -1 : first.name > second.name ? 1 : 0) ||
            first.jobId - second.jobId
    );

    for (const file of ordered) {
        let chosen = orderedMembers[0]!;
        for (const member of orderedMembers)
            if (loads.get(member.id)! < loads.get(chosen.id)!) chosen = member;

        owners.set(file.jobId, chosen.id);
        loads.set(chosen.id, loads.get(chosen.id)! + file.size);
    }

    return files.map((file) => ({
        jobId: file.jobId,
        accountId: owners.get(file.jobId) ?? null
    }));
}
