import { expect, test } from 'vitest';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import { DriveSelection } from '#browser/drive/selection.svelte';
import {
    bulkMoveDestinations,
    selectedFiles,
    selectionScope,
    selectionSummary
} from '#browser/drive/selection-files';
import { bulkFailureMessage } from '#browser/drive/bulk-results';

const visible = ['a', 'b', 'c', 'd', 'e'];

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'first@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        folder: '',
        size: 4,
        at: 1,
        mediaKey: 'media-0',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

function file(overrides: Partial<FileGroup> = {}): FileGroup {
    return {
        email: 'first@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'proof.bin',
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk()],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true,
        ...overrides
    };
}

test('a click toggles and a shift click extends from the last toggled file', () => {
    const selection = new DriveSelection();

    selection.toggle('a');
    selection.toggle('b');
    expect([...selection.selectedKeys]).toEqual(['a', 'b']);

    selection.toggle('a');
    expect([...selection.selectedKeys]).toEqual(['b']);

    selection.extendTo('d', visible);
    expect([...selection.selectedKeys]).toEqual(['b', 'a', 'c', 'd']);

    selection.extendTo('a', visible);
    expect([...selection.selectedKeys]).toEqual(['b', 'a', 'c', 'd']);
});

test('select all covers the visible order, and remove and clear prune the set', () => {
    const selection = new DriveSelection();

    selection.selectAll(visible);
    expect(selection.size).toBe(5);
    expect([...selection.selectedKeys]).toEqual(visible);

    selection.remove('c');
    expect(selection.has('c')).toBe(false);
    expect(selection.size).toBe(4);

    selection.clear();
    expect(selection.size).toBe(0);
    expect([...selection.selectedKeys]).toEqual([]);
});

test('select only replaces the previous selection', () => {
    const selection = new DriveSelection();

    selection.selectAll(visible);
    selection.selectOnly('c');

    expect([...selection.selectedKeys]).toEqual(['c']);
});

test('the selection scope covers folder navigation and every filter', () => {
    const parts = { folder: '', searchTerm: '', typeFilter: '', modifiedDays: '' };
    const initial = selectionScope(parts);

    expect(selectionScope({ ...parts, folder: 'A' })).not.toBe(initial);
    expect(selectionScope({ ...parts, searchTerm: 'proof' })).not.toBe(initial);
    expect(selectionScope({ ...parts, typeFilter: 'png' })).not.toBe(initial);
    expect(selectionScope({ ...parts, modifiedDays: '7' })).not.toBe(initial);
});

test('selected files follow their visible order', () => {
    const first = file({ fileId: 'a'.repeat(64), name: 'first.bin' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin' });
    const keys = new Set([fileKey(second), fileKey(first)]);

    expect(selectedFiles([first, second], keys).map((item) => item.name)).toEqual([
        'first.bin',
        'second.bin'
    ]);
});

test('bulk move offers only folders every owner has', () => {
    const first = file({ folder: 'Shared', fileId: 'a'.repeat(64) });
    const second = file({
        email: 'second@example.com',
        folder: 'Shared',
        fileId: 'b'.repeat(64),
        chunks: [chunk({ email: 'second@example.com', mediaKey: 'second' })]
    });
    const onlyFirst = file({ folder: 'First only', fileId: 'c'.repeat(64) });
    const onlySecond = file({
        email: 'second@example.com',
        folder: 'Second only',
        fileId: 'd'.repeat(64),
        chunks: [chunk({ email: 'second@example.com', mediaKey: 'second-two' })]
    });

    const destinations = bulkMoveDestinations(
        [first, second, onlyFirst, onlySecond],
        [first, second]
    );

    expect(destinations.map((entry) => entry.value)).toEqual(['', 'Shared']);
});

test('selection details sum complete sizes and count incomplete files and owners', () => {
    const first = file({
        chunks: [chunk({ size: 4 }), chunk({ chunkIndex: 1, size: 6, mediaKey: 'media-1' })]
    });
    const second = file({
        email: 'second@example.com',
        complete: false,
        chunks: [chunk({ email: 'second@example.com', size: 100, mediaKey: 'second' })]
    });

    expect(selectionSummary([first, second])).toEqual({
        count: 2,
        size: 10,
        incomplete: 1,
        owners: ['first@example.com', 'second@example.com']
    });
});

test('bulk failures are reported per owner with the file name', () => {
    const message = bulkFailureMessage(
        [
            { email: 'second@example.com', name: 'second.bin', message: 'Paused' },
            { email: 'first@example.com', name: 'first.bin', message: 'No access' },
            { email: 'second@example.com', name: 'third.bin', message: 'Timeout' }
        ],
        5,
        'delete'
    );

    expect(message).toContain('Deleted 2 of 5 files.');
    expect(message).toContain('first@example.com: first.bin: No access');
    expect(message).toContain('second@example.com: second.bin: Paused third.bin: Timeout');
});

test('a fully failed bulk action says nothing changed', () => {
    expect(
        bulkFailureMessage(
            [{ email: 'first@example.com', name: 'first.bin', message: 'No access' }],
            1,
            'move'
        )
    ).toContain('Could not move any files.');
});
