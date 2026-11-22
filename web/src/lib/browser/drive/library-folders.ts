import {
    childFolders,
    filterFiles,
    sortFiles,
    type FileGroup
} from '@madkarmaa/phodrive-core/files';
import type { FileSort } from '@madkarmaa/phodrive-core/models';

export function foldersFor(files: readonly FileGroup[], folder: string, filtering: boolean) {
    return filtering ? [] : childFolders(files, folder);
}

export function visibleFilesFor(
    files: readonly FileGroup[],
    folder: string,
    filtering: boolean,
    searchTerm: string,
    typeFilter: string,
    modifiedDays: string,
    sort: FileSort
): FileGroup[] {
    const scoped = filtering ? files : files.filter((file) => file.folder === folder);

    return sortFiles(filterFiles(scoped, searchTerm, typeFilter, modifiedDays), sort);
}
