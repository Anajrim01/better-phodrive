export function folderCount(files: number, subfolders: number): string {
    const parts: string[] = [];

    if (files > 0) parts.push(`${files} ${files === 1 ? 'file' : 'files'}`);
    if (subfolders > 0)
        parts.push(`${subfolders} ${subfolders === 1 ? 'subfolder' : 'subfolders'}`);

    return parts.join(' · ');
}
