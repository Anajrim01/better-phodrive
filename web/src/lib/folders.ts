export function folderCount(files: number, subfolders: number): string {
    const parts: string[] = [];
    if (files) parts.push(`${files} ${files === 1 ? 'file' : 'files'}`);
    if (subfolders) parts.push(`${subfolders} ${subfolders === 1 ? 'subfolder' : 'subfolders'}`);

    return parts.join(' · ');
}

export function folderLabel(rootLabel: string, folder: string): string {
    return folder ? folder.split('/').join(' / ') : rootLabel;
}
