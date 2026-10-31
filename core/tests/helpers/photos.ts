import { createHash } from 'node:crypto';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import Varint from 'varint';

export function varint(value: number): Buffer {
    return Buffer.from(Varint.encode(value));
}

export function num(field: number, value: number): Buffer {
    return Buffer.concat([varint(field * 8), varint(value)]);
}

export function bytes(field: number, data: Uint8Array | string): Buffer {
    const body = Buffer.from(data);
    return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
}

export function fingerprint(data: Buffer): Buffer {
    return createHash('sha1').update(data).digest();
}

export function authResponse(): Response {
    return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
}

export function libraryItem(
    key: string,
    remoteName: string,
    data: Buffer,
    trashed = false
): Buffer {
    const details = Buffer.concat([
        bytes(4, remoteName),
        num(9, 42),
        num(10, data.length),
        bytes(13, bytes(1, fingerprint(data))),
        ...(trashed ? [bytes(16, num(3, 1))] : [])
    ]);

    return bytes(2, Buffer.concat([bytes(1, key), bytes(2, details)]));
}

export function libraryPage(...parts: Buffer[]): Buffer {
    return bytes(1, Buffer.concat(parts));
}

export function splitBmpFixture(
    payload: Uint8Array,
    header: { fileHash: string; chunkIndex: number; flags: 0 | 1; fileName?: string }
): Buffer {
    return Buffer.from(
        encodeSplitBmp(payload, {
            fileHash: header.fileHash,
            fileId: header.fileHash,
            chunkIndex: header.chunkIndex,
            flags: header.flags,
            payloadSize: payload.length,
            fileName: header.fileName
        }).unwrap()
    );
}

export function libraryFixture() {
    const fileHash = 'a'.repeat(64);
    const first = splitBmpFixture(Uint8Array.of(1, 2), {
        fileHash,
        chunkIndex: 0,
        flags: 0,
        fileName: 'original.bin'
    });
    const last = splitBmpFixture(Uint8Array.of(3), {
        fileHash,
        chunkIndex: 1,
        flags: 1
    });
    const ordinary = Buffer.alloc(first.length);
    const originals = new Map([
        ['renamed-first', first],
        ['renamed-last', last],
        ['ordinary-video', ordinary],
        ['ordinary-photo', ordinary]
    ]);
    const item = (key: string, remoteName: string, trashed = false) => {
        const data = originals.get(key) ?? first;

        return libraryItem(key, remoteName, data, trashed);
    };
    const phodriveName = (name: string, chunkIndex: number) =>
        `${name}.phodrive-${fileHash}-${chunkIndex}-of-2.bmp`;
    const firstPage = libraryPage(
        bytes(1, 'empty-page'),
        item('renamed-first', phodriveName('vacation.jpg', 0)),
        item('ordinary-video', 'clip.mp4'),
        item('ordinary-photo', 'family.jpg')
    );
    const continuationPage = libraryPage(
        item('renamed-first', phodriveName('deleted-copy.bmp', 0), true),
        item('renamed-last', phodriveName('untitled', 1))
    );
    const syncPage = libraryPage(bytes(6, 'next-sync'));

    return { fileHash, first, last, originals, firstPage, continuationPage, syncPage };
}

export function libraryPrepareMetadata(key: string, data: Buffer): Buffer {
    return bytes(
        1,
        Buffer.concat([
            bytes(1, key),
            bytes(2, bytes(13, bytes(1, fingerprint(data)))),
            bytes(
                5,
                key === 'ordinary-video'
                    ? Buffer.concat([num(1, 2), bytes(3, bytes(5, 'video-download'))])
                    : bytes(2, bytes(5, `https://lh3.googleusercontent.com/p/${key}=d`))
            )
        ])
    );
}
