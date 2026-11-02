export type ViewerCode =
    | 'manifest_missing'
    | 'manifest_invalid'
    | 'album_unavailable'
    | 'album_busy'
    | 'proxy_error'
    | 'share_incomplete'
    | 'chunk_invalid'
    | 'integrity_failed'
    | 'network_failed'
    | 'preview_too_large'
    | 'save_cancelled'
    | 'save_failed'
    | 'too_large';

export interface ViewerFailure {
    code: ViewerCode;
    message: string;
}

export function viewerFailure(code: ViewerCode, message: string): ViewerFailure {
    return { code, message };
}

export function isIncomplete(failure: ViewerFailure): boolean {
    return (
        failure.code === 'share_incomplete' ||
        failure.code === 'chunk_invalid' ||
        failure.code === 'integrity_failed'
    );
}

export function failureDetail(failure: ViewerFailure): string {
    if (failure.code === 'chunk_invalid' || failure.code === 'integrity_failed')
        return 'A chunk is damaged or does not match the shared file. Nothing was saved.';

    return failure.message;
}

export function failureTitle(failure: ViewerFailure): string {
    if (isIncomplete(failure)) return 'Share incomplete';
    if (failure.code === 'album_unavailable') return 'This album is not public';
    if (failure.code === 'manifest_invalid') return 'This share link is not valid';
    if (failure.code === 'network_failed' || failure.code === 'proxy_error')
        return 'The share could not be read';

    return 'This share cannot be opened';
}
