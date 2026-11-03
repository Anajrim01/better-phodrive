import { expect, test } from 'vitest';
import { MAX_SHARE_FILES, SHARE_BASE_URL } from '@madkarmaa/phodrive-core/share-models';
import {
    defaultShareName,
    shareFileCount,
    shareFileInputs,
    shareNameError
} from '#lib/share-files';
import { chunk, file } from './components/file-fixtures';

function shareUrl(manifest: unknown): string {
    const base64 = btoa(JSON.stringify(manifest))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    return `${SHARE_BASE_URL}${base64}`;
}

test('file inputs keep chunk order and media keys', () => {
    const item = file({
        chunks: [
            chunk({ chunkIndex: 1, mediaKey: 'media-1' }),
            chunk({ chunkIndex: 0, mediaKey: 'media-0' })
        ]
    });

    const inputs = shareFileInputs([item]).unwrap();

    expect(inputs).toEqual([
        {
            id: 'a'.repeat(64),
            name: 'proof.bin',
            chunks: [
                { index: 0, mediaKey: 'media-0' },
                { index: 1, mediaKey: 'media-1' }
            ]
        }
    ]);
});

test('an incomplete file is rejected instead of sharing missing chunks', () => {
    const error = shareFileInputs([file({ complete: false })]).unwrapErr();

    expect(error.code).toBe('INCOMPLETE_FILES');
    expect(error.message).toBe('Share needs complete files. Remove incomplete files to continue.');
});

test('a share is limited to the manifest file count', () => {
    const files = Array.from({ length: MAX_SHARE_FILES + 1 }, (_, index) =>
        file({ fileId: index.toString(16).padStart(64, 'a') })
    );

    const error = shareFileInputs(files).unwrapErr();

    expect(error.code).toBe('TOO_MANY_FILES');
    expect(error.message).toBe(`A share can include up to ${MAX_SHARE_FILES} files.`);
});

test('default names drop a single file extension and count multiple files', () => {
    expect(defaultShareName([{ name: 'notes.txt' }])).toBe('notes');
    expect(defaultShareName([{ name: 'archive.tar.gz' }])).toBe('archive.tar');
    expect(defaultShareName([{ name: '.env' }])).toBe('.env');
    expect(defaultShareName([{ name: 'one.txt' }, { name: 'two.txt' }])).toBe('2 files');
});

test('share names require 1 to 200 trimmed characters', () => {
    expect(shareNameError('')).toBe('Enter a name for the share link.');
    expect(shareNameError('   ')).toBe('Enter a name for the share link.');
    expect(shareNameError('a')).toBeNull();
    expect(shareNameError('a'.repeat(200))).toBeNull();
    expect(shareNameError('a'.repeat(201))).toBe('Use 200 characters or fewer.');
});

test('the file count comes from the manifest inside the share link', () => {
    const url = shareUrl({
        v: 1,
        album: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1',
        files: [
            { id: 'a'.repeat(64), chunks: 1, name: 'one.txt' },
            { id: 'b'.repeat(64), chunks: 2, name: 'two.txt' }
        ]
    });

    expect(shareFileCount(url)).toBe(2);
    expect(shareFileCount('https://example.com/#share=abc')).toBeNull();
    expect(shareFileCount(`${SHARE_BASE_URL}not-valid`)).toBeNull();
});
