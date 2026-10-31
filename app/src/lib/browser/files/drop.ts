/** Chromium expands dropped folders into files that keep their `webkitRelativePath`. */
export function droppedFiles(transfer: DataTransfer): File[] {
    return Array.from(transfer.files);
}
