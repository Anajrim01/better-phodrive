import { beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { throttleError } from '@madkarmaa/phodrive-core/server/errors';
import { previewFile } from '@madkarmaa/phodrive-core/server/preview';
import {
    MAX_IMAGE_PREVIEW_BYTES,
    PreviewMode,
    PreviewUnavailableReason
} from '@madkarmaa/phodrive-core/preview';
import { fixture, serve } from '../helpers/preview';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn()
}));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

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
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('photo'), PNG_IEND]);
    const { input } = await fixture('photo.png', PreviewMode.Image, [png]);
    vi.mocked(downloadBmp).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Err(throttleError(120)))
    );

    const result = await previewFile(input, undefined, 'manual');
    expect(result.unwrapErr()).toMatchObject({
        code: 'THROTTLED',
        retryAfterSeconds: 120
    });
});
