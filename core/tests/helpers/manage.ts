import { createHash } from 'node:crypto';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { writeAuthHeaders } from '@madkarmaa/phodrive-core/server/photos/auth-cache';
import {
    readAccountOverrides,
    readAccountState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import type { LibraryOverrides } from '@madkarmaa/phodrive-core/server/photos/library/overrides';

export const MANAGE_EMAIL = 'manage@example.com';
export const MANAGE_TOKEN = 'aas_et/manage';

export function id(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function sha(value: string): string {
    return createHash('sha1').update(value).digest('hex');
}

export function chunk(
    fileId: string,
    mediaKey: string,
    options: {
        name?: string;
        folder?: string;
        index?: number;
        last?: boolean;
        trashedAt?: number;
    } = {}
): RemoteBmp {
    return {
        fileHash: fileId,
        fileId,
        chunkIndex: options.index ?? 0,
        isLast: options.last ?? true,
        ...(options.name === undefined ? {} : { originalName: options.name }),
        ...(options.folder === undefined ? {} : { folder: options.folder }),
        size: 4,
        at: 1,
        mediaKey,
        sha1: sha(mediaKey),
        ...(options.trashedAt === undefined ? {} : { trashedAt: options.trashedAt })
    };
}

export function primeManageAuth(email = MANAGE_EMAIL, token = MANAGE_TOKEN): void {
    writeAuthHeaders(
        email,
        token,
        {
            commonHeaders: { Authorization: 'Bearer test' },
            rpcHeaders: { Authorization: 'Bearer test' }
        },
        Date.now() + 60 * 60 * 1_000
    );
}

export function saveItems(
    items: RemoteBmp[],
    revision = 5,
    email = MANAGE_EMAIL,
    syncToken = 'sync-one'
): void {
    primeManageAuth(email);
    writeAccountState(email, {
        syncToken: Buffer.from(syncToken),
        revision,
        items: new Map(items.map((item) => [item.mediaKey, item])),
        log: []
    });
}

export function savedItems(email = MANAGE_EMAIL): RemoteBmp[] {
    return [...(readAccountState(email)?.items.values() ?? [])];
}

export function overrides(email = MANAGE_EMAIL): LibraryOverrides {
    return readAccountOverrides(email);
}
