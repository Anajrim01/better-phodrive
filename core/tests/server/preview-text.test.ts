import { beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { previewFile } from '@madkarmaa/phodrive-core/server/preview';
import {
    PREVIEW_TEXT_BYTES,
    PREVIEW_TEXT_LINES,
    PreviewMode,
    PreviewUnavailableReason
} from '@madkarmaa/phodrive-core/preview';
import { bmpResponse } from '../helpers/download';
import { fixture, malformedCompressedTextFixture, serve } from '../helpers/preview';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn()
}));

beforeEach(() => {
    vi.clearAllMocks();
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

test('malformed compressed text stops reading after the decoder fails', async () => {
    const { input, bmp } = malformedCompressedTextFixture();
    let received = 0;
    const cancelled = vi.fn();
    vi.mocked(downloadBmp).mockImplementation(() =>
        Ok(
            bmpResponse(bmp, 1024, {
                onRead: (bytes) => {
                    received += bytes;
                },
                onCancel: cancelled
            })
        ).andThenAsync(async (response) => Ok(response))
    );

    const result = await previewFile(input);

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.DECOMPRESSION_FAILED);
    expect(received).toBeLessThan(bmp.length / 2);
    expect(cancelled).toHaveBeenCalledOnce();
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

test('invalid UTF-8 at the end of a complete file is rejected, not trimmed', async () => {
    const { input, bmps } = await fixture('notes.txt', PreviewMode.Text, [
        Buffer.from([0x61, 0x62, 0x63, 0xff])
    ]);
    serve(bmps);

    expect((await previewFile(input)).unwrap()).toEqual({
        kind: 'unavailable',
        reason: PreviewUnavailableReason.Binary
    });
});

test('a multibyte character split by the byte cap is trimmed at the prefix boundary', async () => {
    const bytes = Buffer.concat([
        Buffer.alloc(PREVIEW_TEXT_BYTES - 1, 0x61),
        Buffer.from('é', 'utf8')
    ]);
    const { input, bmps } = await fixture('notes.txt', PreviewMode.Text, [bytes]);
    serve(bmps);

    const result = (await previewFile(input)).unwrap();
    expect(result.kind).toBe('text');
    if (result.kind !== 'text') return;

    expect(result.text).toBe('a'.repeat(PREVIEW_TEXT_BYTES - 1));
    expect(result.truncated).toBe(true);
});
