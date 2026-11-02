import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { fileKey, type FileGroup, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { Result } from 'results-ts';
import { deleteFiles } from '#browser/files';
import type { BulkFailure } from '#browser/drive/bulk-results';

type BulkDelegates = {
    action: FileActionKind;
    resolveToken: (item: FileGroup) => Result<string, ApplicationError>;
    onTrashed: (item: FileGroup, chunk: UploadedChunk) => void;
    onRestored: (item: FileGroup, chunk: UploadedChunk) => void;
    onRemoved: (item: FileGroup, chunk: UploadedChunk) => void;
    remove: (item: FileGroup) => void;
    progress: () => void;
    workers: number;
};

type AccountGroup = { email: string; token: string; files: FileGroup[] };

function failureMessage(action: FileActionKind): string {
    if (action === FileActionKind.DeleteForever) return 'Permanent delete failed';
    if (action === FileActionKind.Restore) return 'Restore failed';

    return 'Move to trash failed';
}

function applyChunk(item: FileGroup, chunk: UploadedChunk, delegates: BulkDelegates): void {
    if (delegates.action === FileActionKind.Delete) {
        delegates.onTrashed(item, chunk);

        return;
    }

    if (delegates.action === FileActionKind.DeleteForever) {
        delegates.onRemoved(item, chunk);

        return;
    }

    delegates.onRestored(item, chunk);
}

async function runAccount(
    group: AccountGroup,
    delegates: BulkDelegates,
    failures: BulkFailure[]
): Promise<void> {
    const seen = new Set<string>();

    await deleteFiles(
        group.email,
        group.token,
        group.files,
        delegates.workers,
        (item, outcome) => {
            seen.add(fileKey(item));
            for (const chunk of outcome.deleted) applyChunk(item, chunk, delegates);

            if (outcome.error) {
                failures.push({ email: item.email, name: item.name, message: outcome.error });
            } else {
                delegates.remove(item);
            }
            delegates.progress();
        },
        delegates.action
    );

    for (const item of group.files) {
        if (seen.has(fileKey(item))) continue;

        failures.push({
            email: item.email,
            name: item.name,
            message: failureMessage(delegates.action)
        });
        delegates.progress();
    }
}

export function isBulkFileAction(
    action: FileActionKind
): action is FileActionKind.Delete | FileActionKind.DeleteForever | FileActionKind.Restore {
    return (
        action === FileActionKind.Delete ||
        action === FileActionKind.DeleteForever ||
        action === FileActionKind.Restore
    );
}

export async function runFilesInBatches(
    files: readonly FileGroup[],
    delegates: BulkDelegates
): Promise<BulkFailure[]> {
    const groups = new Map<string, AccountGroup>();
    const failures: BulkFailure[] = [];

    for (const item of files) {
        const routed = delegates.resolveToken(item).match<{ token: string } | { error: string }>({
            Ok: (token) => ({ token }),
            Err: (error) => ({ error: error.message })
        });
        if ('error' in routed) {
            failures.push({ email: item.email, name: item.name, message: routed.error });
            delegates.progress();

            continue;
        }

        const key = item.email.toLowerCase();
        const group = groups.get(key);
        if (group) group.files.push(item);
        else groups.set(key, { email: item.email, token: routed.token, files: [item] });
    }

    await Promise.all([...groups.values()].map((group) => runAccount(group, delegates, failures)));

    return failures;
}
