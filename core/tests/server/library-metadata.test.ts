import { expect, test } from 'vitest';
import {
    pageRequest,
    parseLibraryPage
} from '@madkarmaa/phodrive-core/server/photos/library/metadata';
import { LIBRARY_PAGE_REQUEST } from '@madkarmaa/phodrive-core/server/photos/library/requests';
import { bytesField, message, nested } from '@madkarmaa/phodrive-core/server/protobuf';
import { bytes, num } from '../helpers/protobuf';

test('library pagination sends the resume token at field 1.4 and preserves the metadata mask', () => {
    const resume = Buffer.from('resume-next-page');
    const request = pageRequest(resume).unwrap();
    const template = Buffer.from(LIBRARY_PAGE_REQUEST, 'base64');

    expect(nested(request, 1, 4).unwrap()).toEqual(resume);
    expect(nested(request, 1, 1).unwrap()).toEqual(nested(template, 1, 1).unwrap());
    expect(nested(request, 2).unwrap()).toEqual(nested(template, 2).unwrap());
});

test('a sync token without a resume token does not advertise another library page', () => {
    const response = bytesField(1, bytesField(6, 'next-sync-cycle'));
    const page = parseLibraryPage(response).unwrap();

    expect(page).toEqual({ items: [], nextPageToken: '', warnings: [] });
});

test('an empty resume token ends pagination even when the sync token remains', () => {
    const response = bytesField(1, message(bytesField(1, ''), bytesField(6, 'next-sync-cycle')));
    const page = parseLibraryPage(response).unwrap();

    expect(page.nextPageToken).toBe('');
});

test('a key-only hidden item is omitted without a parse warning', () => {
    const keyOnly = bytesField(
        2,
        Buffer.concat([bytesField(1, 'key-only'), bytesField(2, bytes(16, num(3, 1)))])
    );
    const page = parseLibraryPage(bytesField(1, keyOnly)).unwrap();

    expect(page.items).toEqual([]);
    expect(page.warnings).toEqual([]);
});

test('a malformed entry is counted without dropping the valid page entries', () => {
    const details = Buffer.concat([
        bytes(4, 'valid.bmp'),
        num(9, 1),
        num(10, 120),
        bytes(13, bytes(1, Buffer.alloc(20, 1)))
    ]);
    const valid = bytesField(
        2,
        Buffer.concat([bytesField(1, 'valid-key'), bytesField(2, details)])
    );
    const malformed = bytesField(2, Buffer.from([0x0a, 0x05, 0x41]));
    const page = parseLibraryPage(bytesField(1, Buffer.concat([valid, malformed]))).unwrap();

    expect(page.items).toEqual([expect.objectContaining({ mediaKey: 'valid-key', size: 120 })]);
    expect(page.warnings).toEqual([{ code: 'ENTRY_PARSE_FAILED', count: 1 }]);
});
