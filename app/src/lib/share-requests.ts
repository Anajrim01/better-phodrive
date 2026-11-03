import type {
    ShareCreateRequest,
    ShareFileInput,
    ShareRecord,
    ShareRevokeRequest
} from '@madkarmaa/phodrive-core/share-models';

export type ShareAccount = { email: string; token: string };

export function shareCreateRequest(
    account: ShareAccount,
    name: string,
    files: ShareFileInput[]
): ShareCreateRequest {
    return {
        action: 'create',
        email: account.email,
        token: account.token,
        name,
        files
    };
}

export function shareRevokeRequest(account: ShareAccount, record: ShareRecord): ShareRevokeRequest {
    return {
        action: 'revoke',
        email: account.email,
        token: account.token,
        envelopeKey: record.envelopeKey,
        albumKey: record.albumKey,
        shortUrl: record.shortUrl,
        albumUrl: record.albumUrl
    };
}
