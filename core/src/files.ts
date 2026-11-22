import { Err, Ok, type Result } from 'results-ts';
import { FileSort, FileActionKind, FolderPathSchema } from './models';
import { MAX_CHUNK_PAYLOAD_BYTES } from './bmp/format';
import type { ApplicationError } from './errors';
import type { FileGroup } from './file-groups';

export { fileKey, groupChunks, ownerKey, partitionFileGroups } from './file-groups';
export type { FileGroup, UploadedChunk } from './file-groups';

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
