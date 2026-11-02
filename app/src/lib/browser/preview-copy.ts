import { PreviewUnavailableReason } from '@madkarmaa/phodrive-core/preview';

export type PreviewState =
    | { kind: 'loading' }
    | { kind: 'image'; url: string }
    | { kind: 'text'; text: string; truncated: boolean }
    | { kind: 'unavailable'; reason: PreviewUnavailableReason }
    | { kind: 'error'; message: string };

export function previewReason(value: PreviewUnavailableReason): string {
    if (value === PreviewUnavailableReason.MultiChunk)
        return 'This image is split across several chunks, so it cannot be shown here. Download it to view the full file.';
    if (value === PreviewUnavailableReason.TooLarge)
        return 'This image is too large to preview here. Download it to view the full file.';
    if (value === PreviewUnavailableReason.UnsupportedImage)
        return 'This file is not a JPEG, PNG, WebP or GIF image. Download it to view the full file.';
    if (value === PreviewUnavailableReason.IncompleteImage)
        return 'This image looks incomplete. Download it to check the file.';
    if (value === PreviewUnavailableReason.DecodeFailed)
        return 'This image could not be decoded. Download it to view the full file.';
    if (value === PreviewUnavailableReason.Binary)
        return 'This file does not look like text. Download it to view the full file.';
    if (value === PreviewUnavailableReason.Incomplete)
        return 'Load the remaining chunks before previewing this file.';

    return 'This file type cannot be previewed. Download it to view the full file.';
}
