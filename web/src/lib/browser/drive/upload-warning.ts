import type { UploadWarning } from '@madkarmaa/phodrive-core/models';

/** The upload is confirmed; only the local metadata index could not be updated. */
export function uploadWarningMessage(
    warnings: readonly UploadWarning[] | undefined
): string | null {
    return warnings?.some((warning) => warning.code === 'METADATA_SAVE_FAILED')
        ? 'Uploaded, but Phodrive could not update its metadata index.'
        : null;
}
