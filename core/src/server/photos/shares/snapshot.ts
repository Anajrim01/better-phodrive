import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { FileNameSchema, FolderPathSchema, type RemoteBmp } from '../../../models';
import { groupChunks, type FileGroup, type UploadedChunk } from '../../../file-groups';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import type { ChunkMetadataStore } from '../library/index';
import { listBmps } from '../library/index';
import type { ThrottleScope } from '../throttle';

export type SnapshotAccount = { email: string; token: string };

export type SnapshotFile = {
    accountEmail: string;
    file: FileGroup;
    relativeFolder: string;
    size: number;
    complete: boolean;
    partialTrash: boolean;
    invalid: boolean;
};

export type AccountSnapshot = {
    accountEmail: string;
    files: SnapshotFile[];
};

type ListPage = typeof listBmps;

type SnapshotOptions = {
    metadata?: ChunkMetadataStore;
    scope?: ThrottleScope;
    listPage?: ListPage;
};

function activeChunks(group: FileGroup): UploadedChunk[] {
    return group.chunks.filter((chunk) => !chunk.trashed);
}

function activeComplete(group: FileGroup, chunks: readonly UploadedChunk[]): boolean {
    if (!chunks.length) return false;

    const last = chunks.find((chunk) => chunk.isLast);
    if (!last) return false;

    return (
        chunks.length === last.chunkIndex + 1 &&
        chunks.every(
            (chunk, index) =>
                chunk.chunkIndex === index &&
                chunk.fileHash === group.fileHash &&
                chunk.fileId === group.fileId
        )
    );
}

function validFile(group: FileGroup): boolean {
    if (!group.fileId || !group.fileHash) return false;
    if (!group.chunks[0]?.originalName) return false;
    if (!FileNameSchema.safeParse(group.name).success) return false;
    if (group.folder && !FolderPathSchema.safeParse(group.folder).success) return false;

    return true;
}

function readPages(
    account: SnapshotAccount,
    listPage: ListPage,
    options: SnapshotOptions,
    seen: Set<string>,
    chunks: UploadedChunk[],
    pageToken: string
): AsyncResult<void, ServerError> {
    return listPage(
        account.email,
        account.token,
        pageToken,
        undefined,
        options.metadata,
        options.scope
    ).andThenAsync<void, ServerError>(async (data) => {
        if (data.warnings.some((warning) => warning.code === 'ENTRY_PARSE_FAILED'))
            return Err(SERVER_ERRORS.SHARE_SNAPSHOT_INCOMPLETE);

        chunks.push(
            ...data.items.map((item: RemoteBmp) => ({
                ...item,
                email: account.email,
                accountId: account.email
            }))
        );

        if (!data.nextPageToken) return Ok(undefined);
        if (seen.has(data.nextPageToken)) return Err(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);
        seen.add(data.nextPageToken);

        return readPages(account, listPage, options, seen, chunks, data.nextPageToken);
    });
}

function accountSnapshot(accountEmail: string, chunks: UploadedChunk[]): AccountSnapshot {
    const files: SnapshotFile[] = [];

    for (const group of groupChunks(chunks)) {
        const active = activeChunks(group);
        const partialTrash = group.chunks.length !== active.length;
        if (!active.length) {
            files.push({
                accountEmail,
                file: {
                    ...group,
                    chunks: active,
                    complete: false,
                    chunkCount: group.chunkCount
                },
                relativeFolder: group.folder,
                size: 0,
                complete: false,
                partialTrash,
                invalid: true
            });

            continue;
        }

        const complete = !partialTrash && activeComplete(group, active);
        const file: FileGroup = {
            ...group,
            chunks: active,
            complete,
            chunkCount: complete ? active.length : group.chunkCount
        };

        files.push({
            accountEmail,
            file,
            relativeFolder: file.folder,
            size: active.reduce((sum, chunk) => sum + chunk.size, 0),
            complete,
            partialTrash,
            invalid: !validFile(file)
        });
    }

    return { accountEmail, files };
}

export function readAccountSnapshot(
    account: SnapshotAccount,
    options: SnapshotOptions = {}
): AsyncResult<AccountSnapshot, ServerError> {
    const listPage = options.listPage ?? listBmps;
    const seen = new Set<string>();
    const chunks: UploadedChunk[] = [];
    const pages = readPages(account, listPage, options, seen, chunks, '');

    return pages.map(() => accountSnapshot(account.email, chunks));
}

export function fileSnapshot(
    snapshot: AccountSnapshot,
    fileId: string
): Result<SnapshotFile, ServerError> {
    const file = snapshot.files.find((current) => current.file.fileId === fileId);
    if (!file) return Err(SERVER_ERRORS.SHARE_FILE_NOT_FOUND);
    if (!file.complete || file.partialTrash || file.invalid)
        return Err(SERVER_ERRORS.SHARE_SNAPSHOT_INCOMPLETE);

    return Ok(file);
}

export function folderSnapshot(
    snapshot: AccountSnapshot,
    folder: string
): Result<SnapshotFile[], ServerError> {
    if (folder && !FolderPathSchema.safeParse(folder).success)
        return Err(SERVER_ERRORS.SHARE_INVALID);

    const prefix = folder ? `${folder}/` : '';
    const files = snapshot.files.filter((current) => {
        if (!current.file.chunks.length) return false;

        const currentFolder = current.file.folder;

        return folder ? currentFolder === folder || currentFolder.startsWith(prefix) : true;
    });
    if (!files.length) return Err(SERVER_ERRORS.SHARE_INVALID);
    if (files.some((file) => !file.complete || file.partialTrash || file.invalid))
        return Err(SERVER_ERRORS.SHARE_SNAPSHOT_INCOMPLETE);

    return Ok(files);
}

export function relativeFolder(file: SnapshotFile, folder: string): string {
    if (!folder) return file.file.folder;

    return file.file.folder === folder ? '' : file.file.folder.slice(folder.length + 1);
}
