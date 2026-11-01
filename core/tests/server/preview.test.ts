import { createHash } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import {
    SPLIT_FLAG_COMPRESSED,
    SPLIT_FLAG_LAST,
    type RemoteBmp,
    type SplitHeader
} from '@madkarmaa/phodrive-core/models';
import {
    MAX_IMAGE_PREVIEW_BYTES,
    PREVIEW_TEXT_BYTES,
    PREVIEW_TEXT_LINES,
    PreviewMode,
    PreviewUnavailableReason,
    type FilePreviewRequest
} from '@madkarmaa/phodrive-core/preview';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { compressPayload } from '@madkarmaa/phodrive-core/server/compress';
import { previewFile } from '@madkarmaa/phodrive-core/server/preview';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { throttleError } from '@madkarmaa/phodrive-core/server/errors';
import { bmpResponse } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn()
}));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function sha1(bytes: Uint8Array): string {
    return createHash('sha1').update(bytes).digest('hex');
}

async function fixture(
    name: string,
    mode: PreviewMode,
    parts: Uint8Array[],
    compress = false
): Promise<{ input: FilePreviewRequest; bmps: Uint8Array[] }> {
    const fileHash = sha256(parts[0] ?? new Uint8Array());
    const fileId = sha256(Buffer.from(`${name}:${fileHash}`));
    const bmps: Uint8Array[] = [];
    const chunks: RemoteBmp[] = [];

    for (const [index, part] of parts.entries()) {
        const stored = compress
            ? (await compressPayload(part)).unwrap()
            : {
                  data: part,
                  compressed: false,
                  originalSize: part.length,
                  storedSize: part.length
              };
        const header: SplitHeader = {
            fileHash,
            fileId,
            chunkIndex: index,
            flags:
                (index === parts.length - 1 ? SPLIT_FLAG_LAST : 0) |
                (stored.compressed ? SPLIT_FLAG_COMPRESSED : 0),
            payloadSize: stored.storedSize,
            originalSize: stored.compressed ? stored.originalSize : undefined,
            fileName: index === 0 ? name : undefined
        };
        const bmp = encodeSplitBmp(stored.data, header).unwrap();
        bmps.push(bmp);
        chunks.push({
            fileHash,
            fileId,
            chunkIndex: index,
            isLast: index === parts.length - 1,
            originalName: index === 0 ? name : undefined,
            size: stored.originalSize,
            storedSize: stored.storedSize,
            compressed: stored.compressed,
            at: 1,
            mediaKey: `chunk-${index}`,
            sha1: sha1(bmp)
        });
    }

    return {
        input: {
            mode,
            email: 'test@example.com',
            token: 'aas_et/test',
            name,
            fileHash,
            fileId,
            chunks
        },
        bmps
    };
}

function serve(bmps: Uint8Array[]): void {
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) => {
        const bmp = bmps[Number(key.slice(-1))];
        if (!bmp) return Ok(undefined).andThenAsync(async () => Err(throttleError(1)));

        return Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

test.each([
    [
        'image/jpeg',
        Buffer.concat([
            Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
            Buffer.from('photo'),
            Buffer.from([0xff, 0xd9])
        ])
    ],
    ['image/png', Buffer.concat([PNG_SIGNATURE, Buffer.from('photo'), PNG_IEND])],
    ['image/gif', Buffer.from('GIF89a-photo;', 'latin1')],
    [
        'image/webp',
        (() => {
            const bytes = Buffer.from('RIFF\0\0\0\0WEBP-photo', 'latin1');
            bytes.writeUInt32LE(bytes.length - 8, 4);

            return bytes;
        })()
    ]
])('a complete single-chunk %s image is returned from chunk zero', async (mime, bytes) => {
    const { input, bmps } = await fixture('photo.png', PreviewMode.Image, [bytes]);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result.kind).toBe('image');
    if (result.kind !== 'image') return;

    expect(result.contentType).toBe(mime);
    expect(Buffer.from(result.bytes)).toEqual(Buffer.from(bytes));
    expect(downloadBmp).toHaveBeenCalledOnce();
});

test('a multi-chunk image falls back before contacting Photos', async () => {
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('photo'), PNG_IEND]);
    const { input } = await fixture('photo.png', PreviewMode.Image, [
        png.subarray(0, 10),
        png.subarray(10)
    ]);

    const result = (await previewFile(input)).unwrap();
    expect(result).toEqual({
        kind: 'unavailable',
        reason: PreviewUnavailableReason.MultiChunk
    });
    expect(downloadBmp).not.toHaveBeenCalled();
});

test('an oversized image falls back before contacting Photos', async () => {
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('photo'), PNG_IEND]);
    const { input } = await fixture('photo.png', PreviewMode.Image, [png]);
    input.chunks[0]!.size = MAX_IMAGE_PREVIEW_BYTES + 1;

    const result = (await previewFile(input)).unwrap();
    expect(result).toEqual({ kind: 'unavailable', reason: PreviewUnavailableReason.TooLarge });
    expect(downloadBmp).not.toHaveBeenCalled();
});

test('a compressed image is decoded from its stored chunk', async () => {
    const bytes = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(120_000, 0x2a), PNG_IEND]);
    const { input, bmps } = await fixture('photo.png', PreviewMode.Image, [bytes], true);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result.kind).toBe('image');
    if (result.kind !== 'image') return;

    expect(result.contentType).toBe('image/png');
    expect(Buffer.from(result.bytes)).toEqual(bytes);
});

test('an image with an incomplete container falls back', async () => {
    const bytes = Buffer.concat([PNG_SIGNATURE, Buffer.from('photo')]);
    const { input, bmps } = await fixture('photo.png', PreviewMode.Image, [bytes]);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result).toEqual({
        kind: 'unavailable',
        reason: PreviewUnavailableReason.IncompleteImage
    });
});

test('a text preview stops at 64 KiB and reports truncation', async () => {
    const bytes = Buffer.alloc(PREVIEW_TEXT_BYTES + 10, 0x61);
    const { input, bmps } = await fixture('notes.txt', PreviewMode.Text, [bytes]);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result.kind).toBe('text');
    if (result.kind !== 'text') return;

    expect(result.text.length).toBe(PREVIEW_TEXT_BYTES);
    expect(result.truncated).toBe(true);
});

test('a text preview stops at 200 lines and reports truncation', async () => {
    const lines = Array.from({ length: PREVIEW_TEXT_LINES + 50 }, (_, index) => `line ${index}`);
    const { input, bmps } = await fixture('notes.txt', PreviewMode.Text, [
        Buffer.from(lines.join('\n'))
    ]);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result.kind).toBe('text');
    if (result.kind !== 'text') return;

    expect(result.text.split('\n')).toHaveLength(PREVIEW_TEXT_LINES);
    expect(result.truncated).toBe(true);
});

test('an empty text file previews as empty text', async () => {
    const { input, bmps } = await fixture('notes.txt', PreviewMode.Text, [new Uint8Array()]);
    serve(bmps);

    expect((await previewFile(input)).unwrap()).toEqual({
        kind: 'text',
        text: '',
        truncated: false
    });
});

test('a multi-chunk text preview reads only chunk zero and marks the result truncated', async () => {
    const { input, bmps } = await fixture('notes.txt', PreviewMode.Text, [
        Buffer.from('first\n'),
        Buffer.from('second\n')
    ]);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result).toEqual({ kind: 'text', text: 'first\n', truncated: true });
    expect(downloadBmp).toHaveBeenCalledOnce();
    expect(vi.mocked(downloadBmp).mock.calls[0]?.[2]).toBe('chunk-0');
});

test('a compressed large text prefix is bounded without buffering the chunk', async () => {
    const bytes = Buffer.alloc(PREVIEW_TEXT_BYTES * 4, 0x61);
    const { input, bmps } = await fixture('notes.txt', PreviewMode.Text, [bytes], true);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result.kind).toBe('text');
    if (result.kind !== 'text') return;

    expect(result.text.length).toBe(PREVIEW_TEXT_BYTES);
    expect(result.truncated).toBe(true);
});

test('a small compressed text file decodes completely', async () => {
    const bytes = Buffer.from('hello from a compressed note\n');
    const { input, bmps } = await fixture('notes.txt', PreviewMode.Text, [bytes], true);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result).toEqual({
        kind: 'text',
        text: bytes.toString('utf8'),
        truncated: false
    });
});

test.each([
    ['binary zeros', Buffer.from([0x00, 0x01, 0x02, 0x03])],
    ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0xfd, 0xfc])]
])('a text file with %s falls back', async (_label, bytes) => {
    const { input, bmps } = await fixture('notes.txt', PreviewMode.Text, [bytes]);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result).toEqual({ kind: 'unavailable', reason: PreviewUnavailableReason.Binary });
});

test('unsupported names and mismatched modes do not contact Photos', async () => {
    const pdf = await fixture('report.pdf', PreviewMode.Text, [Buffer.from('not a pdf')]);
    expect((await previewFile(pdf.input)).unwrap()).toEqual({
        kind: 'unavailable',
        reason: PreviewUnavailableReason.Unsupported
    });

    const text = await fixture('notes.txt', PreviewMode.Image, [Buffer.from('text')]);
    expect((await previewFile(text.input)).unwrap()).toEqual({
        kind: 'unavailable',
        reason: PreviewUnavailableReason.Unsupported
    });
    expect(downloadBmp).not.toHaveBeenCalled();
});

test('a throttled chunk fetch stays a retryable error', async () => {
    const { input } = await fixture('photo.png', PreviewMode.Image, [
        Buffer.concat([PNG_SIGNATURE, Buffer.from('photo'), PNG_IEND])
    ]);
    vi.mocked(downloadBmp).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Err(throttleError(120)))
    );

    const result = await previewFile(input, undefined, 'manual');
    expect(result.unwrapErr()).toMatchObject({
        code: 'THROTTLED',
        retryAfterSeconds: 120
    });
});
