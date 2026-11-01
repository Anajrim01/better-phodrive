// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { DriveManage } from '#browser/drive/manage.svelte';

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'first@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'photo.png',
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
        name: 'photo.png',
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

type Deps = ConstructorParameters<typeof DriveManage>[0];

function makeManage(overrides: Partial<Deps> = {}) {
    const feedback = vi.fn();
    const deps: Deps = {
        account: () => ({ email: 'first@example.com', token: 'token-first' }),
        groupMode: () => false,
        routeMembers: () => [],
        files: () => [file()],
        busy: () => false,
        loading: () => false,
        workers: () => 2,
        feedback,
        applyItems: vi.fn(),
        openFolder: vi.fn(),
        currentFolder: () => '',
        ...overrides
    };

    return { manage: new DriveManage(deps), feedback };
}

test('opening a preview routes the owner token and closing restores focus', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { manage } = makeManage();

    manage.openPreview({ kind: 'file', item: file() }, trigger);

    expect(manage.dialog).toBe('preview');
    expect(manage.previewToken).toBe('token-first');

    manage.closeDialog();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manage.dialog).toBeNull();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
});

test('a group member preview uses that member token', () => {
    const { manage } = makeManage({
        groupMode: () => true,
        routeMembers: () => [{ email: 'first@example.com', token: 'token-group', paused: false }]
    });

    manage.openPreview({ kind: 'file', item: file() });

    expect(manage.dialog).toBe('preview');
    expect(manage.previewToken).toBe('token-group');
});

test('a paused owner is reported instead of opening a preview', () => {
    const { manage, feedback } = makeManage({
        groupMode: () => true,
        routeMembers: () => [{ email: 'first@example.com', token: 'token-group', paused: true }]
    });

    manage.openPreview({ kind: 'file', item: file() });

    expect(manage.dialog).toBeNull();
    expect(feedback).toHaveBeenCalledWith(
        'Files owned by first@example.com cannot download while that account is paused.'
    );
});

test('an incomplete file still opens the fallback preview', () => {
    const { manage } = makeManage();

    manage.openPreview({ kind: 'file', item: file({ complete: false }) });

    expect(manage.dialog).toBe('preview');
    expect(manage.previewToken).toBe('token-first');
});
