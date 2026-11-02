import type { ShareRecovery } from '../errors';

export function recoveryError(
    envelopeKey: string | undefined,
    albumKey: string
): {
    code: 'SHARE_LINK_UNCERTAIN';
    message: string;
    recovery: ShareRecovery;
} {
    return {
        code: 'SHARE_LINK_UNCERTAIN',
        message: 'The share link may still be public. Remove this share album manually.',
        recovery: { albumKey, ...(envelopeKey === undefined ? {} : { envelopeKey }) }
    };
}
