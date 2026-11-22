import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';

/** Spike-only failures; they stay out of the production error table until sharing ships. */
export const SPIKE_ERRORS = {
    GOOGLE_SHARE_RESPONSE_INVALID: {
        code: 'GOOGLE_SHARE_RESPONSE_INVALID',
        message: 'Google Photos returned an unexpected share response.'
    },
    GOOGLE_SHARE_LINK_INVALID: {
        code: 'GOOGLE_SHARE_LINK_INVALID',
        message: 'This is not a public Google Photos album link.'
    },
    GOOGLE_LISTING_SHAPE_CHANGED: {
        code: 'GOOGLE_LISTING_SHAPE_CHANGED',
        message: 'The Google Photos album format changed. The share cannot be read safely.'
    },
    GOOGLE_LISTING_INCOMPLETE: {
        code: 'GOOGLE_LISTING_INCOMPLETE',
        message: 'The Google Photos album listing is incomplete.'
    },
    GOOGLE_LISTING_PAGINATION_UNKNOWN: {
        code: 'GOOGLE_LISTING_PAGINATION_UNKNOWN',
        message: 'The Google Photos album uses an unknown pagination format.'
    }
} as const;

export type ProtocolError = ServerError | (typeof SPIKE_ERRORS)[keyof typeof SPIKE_ERRORS];
