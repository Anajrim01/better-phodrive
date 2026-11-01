/**
 * Browser job totals are raw plan sizes. These helpers map a chunk's work onto
 * that scale, first incoming raw bytes, then stored bytes sent to Google. The
 * commit stays outside the reported ceiling.
 */
export const COMMIT_TAIL_SHARE = 0.01;
export const COMPRESSED_READ_SHARE = 0.12;
export const COMPRESSED_UPLOAD_START_SHARE = 0.15;

export function progressCeiling(total: number): number {
    return Math.max(1, total - Math.max(1, Math.floor(total * COMMIT_TAIL_SHARE)));
}

export function readProgress(total: number, read: number, rawSize: number): number {
    if (rawSize <= 0 || read <= 0) return 0;

    const complete = Math.round(total * COMPRESSED_READ_SHARE);
    const received = Math.min(read, rawSize);

    return Math.min(progressCeiling(total), Math.round((complete * received) / rawSize));
}

export function compressedUploadStart(total: number): number {
    return Math.min(progressCeiling(total), Math.round(total * COMPRESSED_UPLOAD_START_SHARE));
}

export function sentProgress(total: number, sent: number, length: number, from = 0): number {
    const ceiling = progressCeiling(total);
    const start = Math.min(ceiling, Math.max(0, from));
    if (length <= 0) return start;

    const fraction = Math.max(0, Math.min(1, sent / length));

    return start + Math.round((ceiling - start) * fraction);
}
