import { expect, test } from 'vitest';
import {
    pageRequest,
    parseLibraryPage,
    stateRequest
} from '@madkarmaa/phodrive-core/server/photos/library/metadata';
import {
    LIBRARY_PAGE_REQUEST,
    LIBRARY_STATE_REQUEST
} from '@madkarmaa/phodrive-core/server/photos/library/requests';
import { bytesField, message, nested, numberField } from '@madkarmaa/phodrive-core/server/protobuf';
import { fixture, libraryPage } from '../helpers/library';

test('library pagination sends the resume token at field 1.4 and preserves the metadata mask', () => {
    const resume = Buffer.from('resume-next-page');
    const request = pageRequest(resume).unwrap();
    const template = Buffer.from(LIBRARY_PAGE_REQUEST, 'base64');

    expect(nested(request, 1, 4).unwrap()).toEqual(resume);
    expect(nested(request, 1, 1).unwrap()).toEqual(nested(template, 1, 1).unwrap());
    expect(nested(request, 2).unwrap()).toEqual(nested(template, 2).unwrap());
});

test('library pagination sends the sync token at field 1.6', () => {
    const resume = Buffer.from('resume-next-page');
    const sync = Buffer.from('sync-context');
    const request = pageRequest(resume, sync).unwrap();
    const template = Buffer.from(LIBRARY_PAGE_REQUEST, 'base64');

    expect(nested(request, 1, 4).unwrap()).toEqual(resume);
    expect(nested(request, 1, 6).unwrap()).toEqual(sync);
    expect(nested(request, 1, 1).unwrap()).toEqual(nested(template, 1, 1).unwrap());
});

test('the first delta state request carries 1.6 with no resume field', () => {
    const sync = Buffer.from('sync-context');
    const request = stateRequest(sync).unwrap();
    const template = Buffer.from(LIBRARY_STATE_REQUEST, 'base64');

    expect(nested(request, 1, 6).unwrap()).toEqual(sync);
    expect(nested(request, 1, 4).isErr()).toBe(true);
    expect(nested(request, 1, 1).unwrap()).toEqual(nested(template, 1, 1).unwrap());
});

test('a sync token without a resume token does not advertise another library page', () => {
    const response = bytesField(1, bytesField(6, 'next-sync-cycle'));
    const page = parseLibraryPage(response).unwrap();

    expect(page.items).toEqual([]);
    expect(page.nextPageToken).toBe('');
    expect(page.syncToken?.toString()).toBe('next-sync-cycle');
});

test('delta pages parse deletions and the next sync token', () => {
    const deletion = bytesField(
        9,
        message(
            bytesField(
                1,
                message(numberField(1, 1), bytesField(2, message(bytesField(1, 'media-removed'))))
            )
        )
    );
    const response = bytesField(
        1,
        message(bytesField(1, ''), bytesField(6, 'next-sync'), deletion)
    );
    const page = parseLibraryPage(response).unwrap();

    expect(page.deletedMediaKeys).toEqual(['media-removed']);
    expect(page.syncToken?.toString()).toBe('next-sync');
});

test('an empty resume token ends pagination even when the sync token remains', () => {
    const response = bytesField(1, message(bytesField(1, ''), bytesField(6, 'next-sync-cycle')));
    const page = parseLibraryPage(response).unwrap();

    expect(page.nextPageToken).toBe('');
});

test('oversized and undersized visible items are skipped without failing the page', () => {
    const file = fixture('note.txt', 'valid content');
    const response = libraryPage([
        { ...file, fileName: `note.txt.phodrive-${file.sha1}-0-of-1.bmp` },
        { mediaKey: 'huge', sha1: 'a'.repeat(40), size: 300_000_000, at: 1, fileName: 'huge.mp4' },
        { mediaKey: 'tiny', sha1: 'b'.repeat(40), size: 10, at: 1, fileName: 'tiny.bin' }
    ]);
    const page = parseLibraryPage(response).unwrap();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.mediaKey).toBe(file.mediaKey);
});
