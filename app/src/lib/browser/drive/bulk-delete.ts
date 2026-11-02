import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { fileKey, type FileGroup, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { Result } from 'results-ts';
import { deleteFiles } from '#browser/files';
import type { BulkFailure } from '#browser/drive/bulk-results';

type DeleteDelegates = {
    resolveToken: (item: FileGroup) => Result<string, ApplicationError>;
    onTrashed: (item: FileGroup, chunk: UploadedChunk) => void;
    remove: (item: FileGroup) => void;
    progress: () => void;
    fail: (failure: BulkFailure) => void;
    workers: number;
};

type AccountGroup = { email: string; token: string; files: FileGroup[] };

async function deleteAccount(group: AccountGroup, delegates: DeleteDelegates): Promise<void> {
    const seen = new Set<string>();

    await deleteFiles(group.email, group.token, group.files, delegates.workers, (item, outcome) => {
        seen.add(fileKey(item));
        for (const chunk of outcome.deleted) delegates.onTrashed(item, chunk);

        if (outcome.error) {
            delegates.fail({ email: item.email, name: item.name, message: outcome.error });
        } else {
            delegates.remove(item);
        }
        delegates.progress();
    });

    for (const item of group.files) {
        if (seen.has(fileKey(item))) continue;

        delegates.fail({ email: item.email, name: item.name, message: 'Move to trash failed' });
        delegates.progress();
    }
}

export async function deleteFilesInBatches(
    files: readonly FileGroup[],
    delegates: DeleteDelegates
): Promise<void> {
    const groups = new Map<string, AccountGroup>();

    for (const item of files) {
        const routed = delegates.resolveToken(item).match<{ token: string } | { error: string }>({
            Ok: (token) => ({ token }),
            Err: (error) => ({ error: error.message })
        });
        if ('error' in routed) {
            delegates.fail({ email: item.email, name: item.name, message: routed.error });
            delegates.progress();

            continue;
        }

        const key = item.email.toLowerCase();
        const group = groups.get(key);
        if (group) group.files.push(item);
        else groups.set(key, { email: item.email, token: routed.token, files: [item] });
    }

    await Promise.all([...groups.values()].map((group) => deleteAccount(group, delegates)));
}
