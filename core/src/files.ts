import { Err, Ok, type Result } from 'results-ts';
import { FileSort, FileActionKind, FolderPathSchema, type RemoteBmp } from './models';
import { MAX_CHUNK_PAYLOAD_BYTES } from './bmp/format';
import type { ApplicationError } from './errors';

export type UploadedChunk = RemoteBmp & { email: string };

export type FileGroup = {
    email: string;
    accountId?: string;
    fileHash: string;
    fileId: string;
    name: string;
    folder: string;
    at: number;
    chunkCount: number | null;
    chunks: UploadedChunk[];
    complete: boolean;
};

export type FolderEntry = {
    path: string;
    name: string;
    files: number;
    subfolders: number;
};

export type FolderCrumb = { name: string; path: string };

/** Root stays unchanged; non-root folders append one NUL-separated segment. */
export function identityInput(
    name: string,
    fileHash: string,
    chunkPayloadBytes = MAX_CHUNK_PAYLOAD_BYTES,
    folder = ''
): string {
    const base = `${fileHash}\u0000${name}\u0000${chunkPayloadBytes}`;

    return folder ? `${base}\u0000${folder}` : base;
}

export const INVALID_FOLDER_PATH = {
    code: 'INVALID_FOLDER_PATH',
    message: 'Invalid folder path.'
} as const satisfies ApplicationError;

/** Display and lookup helper. API and storage validation must use resolveFolder instead. */
export function normalizedFolder(folder?: string): string {
    const resolved = resolveFolder(folder);

    return resolved.isOk() ? resolved.unwrap() : '';
}

/** Validate one folder path. Root is the empty string. */
export function resolveFolder(folder?: string): Result<string, ApplicationError> {
    if (!folder) return Ok('');

    return FolderPathSchema.safeParse(folder).success ? Ok(folder) : Err(INVALID_FOLDER_PATH);
}

/**
 * Resolve a picker file's folder before identity generation. Empty segments from a relative path
 * stay in place so validation rejects them instead of silently normalizing the path.
 */
export function resolveUploadFolder(file: File, fallback = ''): Result<string, ApplicationError> {
    const root = resolveFolder(fallback);
    if (root.isErr()) return root;

    const relative = 'webkitRelativePath' in file ? file.webkitRelativePath : '';
    if (typeof relative !== 'string' || relative === '') return root;

    const segments = relative.split('/');
    if (segments.at(-1) === '') return Err(INVALID_FOLDER_PATH);
    if (segments.length === 1) return root;

    const path = segments.slice(0, -1).join('/');
    if (!path) return Err(INVALID_FOLDER_PATH);

    const current = root.unwrap();

    return resolveFolder(current ? `${current}/${path}` : path);
}

/** Parent folder of a filesystem-style path. */
export function folderFromPath(path: string): string {
    return path.split(/[\\/]/).slice(0, -1).join('/');
}

export function childFolders(
    files: readonly Pick<FileGroup, 'folder'>[],
    path: string
): FolderEntry[] {
    const prefix = path ? `${path}/` : '';
    const entries = new Map<string, FolderEntry>();
    const subfolders = new Map<string, Set<string>>();

    for (const file of files) {
        if (!file.folder.startsWith(prefix)) continue;
        const rest = file.folder.slice(prefix.length);
        if (!rest) continue;

        const name = rest.split('/')[0]!;
        const childPath = prefix + name;
        const entry = entries.get(childPath) ?? { path: childPath, name, files: 0, subfolders: 0 };

        if (rest === name) entry.files++;
        else {
            const subfolder = rest.slice(name.length + 1).split('/')[0];
            if (subfolder) {
                const paths = subfolders.get(childPath) ?? new Set<string>();
                paths.add(`${childPath}/${subfolder}`);
                subfolders.set(childPath, paths);
            }
        }

        entries.set(childPath, entry);
    }

    for (const [childPath, entry] of entries)
        entry.subfolders = subfolders.get(childPath)?.size ?? 0;

    return [...entries.values()].sort((first, second) => first.name.localeCompare(second.name));
}

export function folderTrail(path: string): FolderCrumb[] {
    if (!path) return [];

    const segments = path.split('/');

    return segments.map((name, index) => ({
        name,
        path: segments.slice(0, index + 1).join('/')
    }));
}

/** The direct-token CLI library has no server account id, so email remains its owner key. */
export function ownerKey(file: { email: string; accountId?: string }): string {
    return file.accountId ?? file.email;
}

export function fileKey(file: { email: string; fileId: string; accountId?: string }): string {
    return `${ownerKey(file)}:${file.fileId}`;
}

type IndexedFileGroup = {
    file: FileGroup;
    chunkPositions?: Map<number, number>;
};

export function groupChunks(items: UploadedChunk[]): FileGroup[] {
    const groups = new Map<string, IndexedFileGroup>();

    for (const chunk of items) {
        const key = fileKey(chunk);
        const entry = groups.get(key);

        if (!entry) {
            const file: FileGroup = {
                email: chunk.email,
                ...(chunk.accountId ? { accountId: chunk.accountId } : {}),
                fileHash: chunk.fileHash,
                fileId: chunk.fileId,
                name: chunk.originalName ?? `File ${chunk.fileHash.slice(0, 12)}`,
                folder: chunk.folder ?? '',
                at: chunk.at,
                chunkCount: null,
                chunks: [chunk],
                complete: false
            };
            groups.set(key, { file });

            continue;
        }

        const group = entry.file;
        let position: number | undefined;
        if (entry.chunkPositions) {
            position = entry.chunkPositions.get(chunk.chunkIndex);
        } else if (group.chunks[0].chunkIndex === chunk.chunkIndex) {
            position = 0;
        }

        const current = position === undefined ? undefined : group.chunks[position];
        group.at = Math.max(group.at, chunk.at);
        if (current && current.at > chunk.at) continue;

        if (position === undefined) {
            // Single-chunk files need no map. Positions stay valid until the final sort.
            entry.chunkPositions ??= new Map([[group.chunks[0].chunkIndex, 0]]);
            entry.chunkPositions.set(chunk.chunkIndex, group.chunks.length);
            group.chunks.push(chunk);
        } else {
            group.chunks[position] = chunk;
        }

        if (chunk.chunkIndex === 0) {
            if (chunk.originalName) group.name = chunk.originalName;
            group.folder = chunk.folder ?? '';
        }
    }

    return [...groups.values()].map(({ file: group }) => {
        group.chunks.sort((first, second) => first.chunkIndex - second.chunkIndex);

        const last = group.chunks.find((chunk) => chunk.isLast);
        group.chunkCount = last ? last.chunkIndex + 1 : null;
        group.complete =
            group.chunkCount !== null &&
            group.chunks.length === group.chunkCount &&
            group.chunks.every((chunk, index) => chunk.chunkIndex === index);

        return group;
    });
}

/** A trailing dot has no extension; an empty type would collide with the "All" filter. */
export function fileType(name: string): string {
    const extension = name.slice(name.lastIndexOf('.') + 1);
    if (!name.includes('.') || !extension) return 'FILE';

    return extension.slice(0, 5).toUpperCase();
}

export function sortFiles(files: readonly FileGroup[], order: FileSort): FileGroup[] {
    return files.toSorted((first, second) => {
        if (order === FileSort.ModifiedDescending)
            return second.at - first.at || first.name.localeCompare(second.name);
        if (order === FileSort.ModifiedAscending)
            return first.at - second.at || first.name.localeCompare(second.name);

        const byName = first.name.localeCompare(second.name);
        if (order === FileSort.NameDescending) return -byName;

        return byName;
    });
}

export type FileAction = { fileId: string; kind: FileActionKind };

const DAY_MS = 86_400_000;

export function filterFiles(
    files: readonly FileGroup[],
    searchTerm: string,
    type: string,
    modifiedDays: string
): FileGroup[] {
    const query = searchTerm.toLocaleLowerCase();
    const modifiedSince = Date.now() - Number(modifiedDays) * DAY_MS;

    return files.filter((file) => {
        if (!file.name.toLocaleLowerCase().includes(query)) return false;
        if (type && fileType(file.name) !== type) return false;
        if (modifiedDays) return file.at >= modifiedSince;

        return true;
    });
}
