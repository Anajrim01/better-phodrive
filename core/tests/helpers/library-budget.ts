import { createHash } from 'node:crypto';
import type { SplitHeader } from '@madkarmaa/phodrive-core/models';
import { encodeSplitBmp } from './split-bmp';
import { bytes, num } from './protobuf';

export type BudgetItem = {
    mediaKey: string;
    at: number;
    bmp: Buffer;
    sha1: string;
    size: number;
    remoteName: string;
    trashed?: boolean;
    video?: boolean;
};

export function budgetItem(input: {
    mediaKey: string;
    at?: number;
    bmp?: Buffer;
    sha1?: string;
    size?: number;
    remoteName?: string;
    trashed?: boolean;
    video?: boolean;
}): BudgetItem {
    const bmp = input.bmp ?? Buffer.alloc(0);
    const sha1 = input.sha1 ?? createHash('sha1').update(bmp).digest('hex');

    return {
        mediaKey: input.mediaKey,
        at: input.at ?? 1,
        bmp,
        sha1,
        size: input.size ?? bmp.length,
        remoteName: input.remoteName ?? `${input.mediaKey}.bmp`,
        ...(input.trashed ? { trashed: true } : {}),
        ...(input.video ? { video: true } : {})
    };
}

export function splitChunk(input: {
    mediaKey: string;
    at?: number;
    payload?: Uint8Array;
    header: SplitHeader;
    remoteName?: string;
    trashed?: boolean;
}): BudgetItem {
    const payload = input.payload ?? Uint8Array.of(1, 2, 3, 4);
    const bmp = Buffer.from(encodeSplitBmp(payload, input.header).unwrap());

    return budgetItem({
        mediaKey: input.mediaKey,
        at: input.at,
        bmp,
        remoteName: input.remoteName,
        trashed: input.trashed
    });
}

export const BUDGET_FILE_HASH = 'a'.repeat(64);
export const BUDGET_FILE_ID = 'b'.repeat(64);

export function fileChunk(
    mediaKey: string,
    chunkIndex: number,
    isLast: boolean,
    payload: Uint8Array,
    options: { at?: number; name?: string; folder?: string; trashed?: boolean } = {}
): BudgetItem {
    const header: SplitHeader = {
        fileHash: BUDGET_FILE_HASH,
        fileId: BUDGET_FILE_ID,
        chunkIndex,
        flags: isLast ? 1 : 0,
        payloadSize: payload.length,
        ...(chunkIndex === 0 ? { fileName: options.name ?? 'file.bin' } : {}),
        ...(chunkIndex === 0 && options.folder ? { folder: options.folder } : {})
    };

    return splitChunk({
        mediaKey,
        at: options.at,
        payload,
        header,
        remoteName: `${mediaKey}.bmp`,
        trashed: options.trashed
    });
}

export function listingPage(items: readonly BudgetItem[], nextPageToken = ''): Buffer {
    const entries = items.map((item) =>
        bytes(
            2,
            Buffer.concat([
                bytes(1, item.mediaKey),
                bytes(
                    2,
                    Buffer.concat([
                        bytes(4, item.remoteName),
                        num(9, item.at),
                        num(10, item.size),
                        bytes(13, bytes(1, Buffer.from(item.sha1, 'hex'))),
                        ...(item.trashed ? [bytes(16, num(3, 1))] : [])
                    ])
                )
            ])
        )
    );
    const page = Buffer.concat([...(nextPageToken ? [bytes(1, nextPageToken)] : []), ...entries]);

    return bytes(1, page);
}
