import { FileSort, FileActionKind, FolderPathSchema, PreviewMode, type RemoteBmp } from './models';
import { MAX_CHUNK_PAYLOAD_BYTES } from './bmp/format';
import { expectedChunks, missingChunks } from './incomplete';

export {
    expectedChunks,
    incompleteChunkMessage,
    incompleteFileMessage,
    missingChunks
} from './incomplete';

export type UploadedChunk = RemoteBmp & { email: string };

export function identityInput(
    name: string,
    fileHash: string,
    chunkPayloadBytes = MAX_CHUNK_PAYLOAD_BYTES,
    folder = ''
): string {
    const base = `${fileHash}\u0000${name}\u0000${chunkPayloadBytes}`;

    return folder ? `${base}\u0000${folder}` : base;
}

export type FileGroup = {
    email: string;
    fileHash: string;
    fileId: string;
    name: string;
    folder: string;
    at: number;
    chunkCount: number | null;
    chunks: UploadedChunk[];
    duplicates: UploadedChunk[];
    trashedChunks: UploadedChunk[];
    trashed: boolean;
    complete: boolean;
};

export function fileKey(file: { email: string; fileId: string }): string {
    return `${file.email}:${file.fileId}`;
}

export function normalizedFolder(folder?: string): string {
    if (!folder) return '';
    if (!FolderPathSchema.safeParse(folder).success) return '';

    return folder;
}

export function folderFromFile(file: File, fallback = ''): string {
    const relative = 'webkitRelativePath' in file ? file.webkitRelativePath : '';
    const segments = typeof relative === 'string' ? relative.split('/').slice(0, -1) : [];
    const path = segments.filter(Boolean).join('/');
    const root = normalizedFolder(fallback);
    const candidate = path ? [root, path].filter(Boolean).join('/') : root;

    return normalizedFolder(candidate);
}

export function folderFromPath(path: string): string {
    const segments = path.split(/[\\/]/).slice(0, -1);

    return normalizedFolder(segments.join('/'));
}

export type FolderEntry = {
    path: string;
    name: string;
    files: number;
    subfolders: number;
};

export function childFolders(files: readonly FileGroup[], path: string): FolderEntry[] {
    const prefix = path ? `${path}/` : '';
    const entries = new Map<string, FolderEntry>();
    const subfolders = new Map<string, Set<string>>();

    for (const file of files) {
        if (!file.folder.startsWith(prefix)) continue;

        const rest = file.folder.slice(prefix.length);
        if (!rest) continue;

        const name = rest.split('/')[0];
        const childPath = `${prefix}${name}`;
        const entry = entries.get(childPath) ?? {
            path: childPath,
            name,
            files: 0,
            subfolders: 0
        };
        if (rest === name) {
            entry.files++;
        } else {
            const subfolder = rest.slice(name.length + 1).split('/')[0];
            if (subfolder) {
                const children = subfolders.get(childPath) ?? new Set<string>();
                children.add(`${childPath}/${subfolder}`);
                subfolders.set(childPath, children);
            }
        }

        entries.set(childPath, entry);
    }

    for (const [childPath, children] of subfolders) {
        const entry = entries.get(childPath);
        if (entry) entry.subfolders = children.size;
    }

    return [...entries.values()].sort((first, second) => first.name.localeCompare(second.name));
}

export type FolderCrumb = { name: string; path: string };

export function folderTrail(path: string): FolderCrumb[] {
    if (!path) return [];

    const segments = path.split('/');

    return segments.map((name, index) => ({
        name,
        path: segments.slice(0, index + 1).join('/')
    }));
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
                fileHash: chunk.fileHash,
                fileId: chunk.fileId,
                name: chunk.originalName ?? `File ${chunk.fileHash.slice(0, 12)}`,
                folder: chunk.folder ?? '',
                at: chunk.at,
                chunkCount: null,
                chunks: [chunk],
                duplicates: [],
                trashedChunks: [],
                trashed: false,
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
        if (current) {
            if (current.at > chunk.at) {
                group.duplicates.push(chunk);
                continue;
            }
            group.duplicates.push(current);
        }

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

        const expected = expectedChunks(group.chunks);
        group.chunkCount = expected;
        group.complete =
            expected !== null &&
            group.chunks.every((chunk) => chunk.chunkIndex < expected) &&
            missingChunks(group.chunks, expected) === 0;

        return group;
    });
}

/** A trailing dot has no extension; an empty type would collide with the "All" filter. */
export function fileType(name: string): string {
    const extension = name.slice(name.lastIndexOf('.') + 1);
    if (!name.includes('.') || !extension) return 'FILE';

    return extension.slice(0, 5).toUpperCase();
}

export const PREVIEW_TEXT_BYTES = 64 * 1024;
export const PREVIEW_TEXT_LINES = 200;
export const MAX_IMAGE_PREVIEW_BYTES = 32 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'webp']);
const TEXT_EXTENSIONS = new Set([
    'astro',
    'bash',
    'bat',
    'c',
    'cc',
    'cfg',
    'cjs',
    'clj',
    'cljs',
    'cmd',
    'conf',
    'cpp',
    'cs',
    'css',
    'csv',
    'cts',
    'cxx',
    'dart',
    'diff',
    'env',
    'erl',
    'ex',
    'exs',
    'fish',
    'gql',
    'gitignore',
    'go',
    'graphql',
    'h',
    'hpp',
    'hrl',
    'hs',
    'ini',
    'java',
    'js',
    'json',
    'jsonl',
    'jsx',
    'kt',
    'kts',
    'less',
    'log',
    'lua',
    'md',
    'mdx',
    'markdown',
    'mjs',
    'ml',
    'mli',
    'mts',
    'ndjson',
    'nim',
    'php',
    'properties',
    'proto',
    'ps1',
    'py',
    'r',
    'rb',
    'rs',
    'sass',
    'scala',
    'scss',
    'sh',
    'sql',
    'svelte',
    'swift',
    'text',
    'toml',
    'ts',
    'tsv',
    'tsx',
    'txt',
    'vue',
    'xml',
    'yaml',
    'yml',
    'zig',
    'zsh'
]);

/** Only listed extensions are previewable; HTML and SVG stay out of the renderer entirely. */
export function previewModeFor(name: string): PreviewMode | null {
    const dot = name.lastIndexOf('.');
    if (dot < 0 || dot === name.length - 1) return null;

    const extension = name.slice(dot + 1).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) return PreviewMode.Image;
    if (TEXT_EXTENSIONS.has(extension)) return PreviewMode.Text;

    return null;
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

export type FileAction = { email: string; fileId: string; kind: FileActionKind };

/** Match progress to the owner as well as the file ID; group members can share one ID. */
export function fileActionKind(
    action: FileAction | null,
    item: { email: string; fileId: string }
): FileActionKind | null {
    if (!action) return null;
    if (action.email.toLowerCase() !== item.email.toLowerCase()) return null;

    return action.fileId === item.fileId ? action.kind : null;
}

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
