import { z } from 'zod';
import { FileNameSchema, FolderPathSchema, Sha256HexSchema, type RemoteBmp } from '../../../models';

export const RootFolderSchema = z.union([FolderPathSchema, z.literal('')]);

export const FolderPrefixSchema = z.object({
    from: FolderPathSchema,
    to: RootFolderSchema
});

export const LibraryOverridesSchema = z.object({
    fileNames: z.record(Sha256HexSchema, FileNameSchema),
    fileFolders: z.record(Sha256HexSchema, RootFolderSchema),
    folderPrefixes: z.array(FolderPrefixSchema)
});

export type FolderPrefix = z.infer<typeof FolderPrefixSchema>;
export type LibraryOverrides = z.infer<typeof LibraryOverridesSchema>;

export function emptyOverrides(): LibraryOverrides {
    return { fileNames: {}, fileFolders: {}, folderPrefixes: [] };
}

export function isEmptyOverrides(overrides: LibraryOverrides): boolean {
    return (
        Object.keys(overrides.fileNames).length === 0 &&
        Object.keys(overrides.fileFolders).length === 0 &&
        overrides.folderPrefixes.length === 0
    );
}

export function parseOverrides(value: unknown): LibraryOverrides {
    const parsed = LibraryOverridesSchema.safeParse(value);

    return parsed.success ? parsed.data : emptyOverrides();
}

export function isInFolder(folder: string, path: string): boolean {
    return folder === path || folder.startsWith(`${path}/`);
}

export function folderSuffix(folder: string, path: string): string {
    return folder === path ? '' : folder.slice(path.length + 1);
}

export function joinFolder(parent: string, child: string): string {
    if (!parent) return child;
    if (!child) return parent;

    return `${parent}/${child}`;
}

export function replacePrefix(folder: string, from: string, to: string): string {
    return joinFolder(to, folderSuffix(folder, from));
}

export function applyMappings(folder: string, mappings: readonly FolderPrefix[]): string {
    let mapped = folder;
    for (const mapping of mappings) {
        if (isInFolder(mapped, mapping.from))
            mapped = replacePrefix(mapped, mapping.from, mapping.to);
    }

    return mapped;
}

/** Root files omit the folder field so listings keep their existing shape. */
export function withListingFolder(item: RemoteBmp, folder: string): RemoteBmp {
    if (folder) return { ...item, folder };
    if (item.folder === undefined) return item;

    const copy = { ...item };
    delete copy.folder;

    return copy;
}

/** Apply persisted listing overrides to one raw item exactly once. */
export function applyOverrides(item: RemoteBmp, overrides: LibraryOverrides): RemoteBmp {
    const name = overrides.fileNames[item.fileId];
    const base = item.folder ?? '';
    const mapped = applyMappings(base, overrides.folderPrefixes);
    const override = overrides.fileFolders[item.fileId];
    const folder = override ?? mapped;
    let result = item;

    if (name !== undefined && name !== item.originalName)
        result = { ...result, originalName: name };
    if (folder !== base) result = withListingFolder(result, folder);

    return result;
}

export function applyOverridesToItems(
    items: Iterable<RemoteBmp>,
    overrides: LibraryOverrides
): RemoteBmp[] {
    return [...items].map((item) => applyOverrides(item, overrides));
}
