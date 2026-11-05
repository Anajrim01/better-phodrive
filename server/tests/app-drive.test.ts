import { beforeEach, expect, test, vi } from 'vitest';
import {
    ChunkFormat,
    GOOGLE_ACCOUNT_HEADER,
    ProcessingMode
} from '@madkarmaa/phodrive-core/models';
import { downloadBmp, listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { deleteFile, deleteForeverFile, restoreFile } from '@madkarmaa/phodrive-core/server/files';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { receiveFileUpload } from '@madkarmaa/phodrive-core/server/upload/file';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { requireSessionUser } from '../src/auth';
import { AUTH_ERRORS } from '../src/errors';
import { readGoogleAccount } from '../src/google';
import { ACCOUNT, USER, call, postJson, rejected, resolved, settings } from './helpers/api';

vi.mock('../src/auth', () => ({
    createAuth: vi.fn(() => ({})),
    handleAuthRequest: vi.fn(),
    readSessionUser: vi.fn(),
    requireSessionUser: vi.fn()
}));
vi.mock('../src/google', () => ({
    readGoogleAccount: vi.fn(),
    readGoogleEmail: vi.fn(),
    saveGoogleAccount: vi.fn()
}));
vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    listBmps: vi.fn(),
    createThrottleCoordinator: () => ({
        pause: vi.fn(),
        wait: vi.fn(),
        remaining: vi.fn(() => 0),
        serverFailure: vi.fn(() => null),
        serverSuccess: vi.fn(),
        success: vi.fn(),
        clear: vi.fn()
    })
}));
vi.mock('@madkarmaa/phodrive-core/server/files', () => ({
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
    restoreFile: vi.fn(),
    deleteForeverFile: vi.fn()
}));
vi.mock('@madkarmaa/phodrive-core/server/upload/input', () => ({ receiveUpload: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/server/upload/file', () => ({
    fileUploadStream: vi.fn(),
    receiveFileUpload: vi.fn()
}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSessionUser).mockReturnValue(resolved(USER));
    vi.mocked(readGoogleAccount).mockReturnValue(resolved(ACCOUNT));
    settings.processing = ProcessingMode.Browser;
});

test('drive routes refuse signed-out requests before contacting Google', async () => {
    vi.mocked(requireSessionUser).mockReturnValue(rejected(AUTH_ERRORS.SIGNED_OUT));

    for (const path of ['/api/library', '/api/files', '/api/upload', '/api/chunk']) {
        const response = await postJson(path, {});
        const body: unknown = await response.json();

        expect(response.status).toBe(401);
        expect(body).toEqual({ error: AUTH_ERRORS.SIGNED_OUT.message });
    }

    expect(readGoogleAccount).not.toHaveBeenCalled();
    expect(listBmps).not.toHaveBeenCalled();
    expect(receiveUpload).not.toHaveBeenCalled();
});

test('the library uses the stored account and ignores credentials sent by the client', async () => {
    vi.mocked(listBmps).mockReturnValue(resolved({ items: [], nextPageToken: '' }));

    const response = await postJson('/api/library', {
        email: 'other@example.com',
        token: 'aas_et/forged',
        pageToken: 'next'
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(readGoogleAccount).mock.calls[0][1]).toBe(USER.id);
    expect(vi.mocked(readGoogleAccount).mock.calls[0][2]).toBeUndefined();
    expect(listBmps).toHaveBeenCalledWith(
        ACCOUNT.email,
        ACCOUNT.token,
        'next',
        undefined,
        expect.anything()
    );
});

test('a drive request selects a Google account by its stable id', async () => {
    vi.mocked(listBmps).mockReturnValue(resolved({ items: [], nextPageToken: '' }));

    const response = await call('/api/library', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            [GOOGLE_ACCOUNT_HEADER]: 'other-account'
        },
        body: JSON.stringify({ pageToken: '' })
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(readGoogleAccount).mock.calls[0][2]).toBe('other-account');
});

test('an unknown account header fails closed instead of using the default account', async () => {
    vi.mocked(readGoogleAccount).mockReturnValue(rejected(AUTH_ERRORS.GOOGLE_ACCOUNT_NOT_FOUND));

    const response = await call('/api/library', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            [GOOGLE_ACCOUNT_HEADER]: 'foreign-account'
        },
        body: JSON.stringify({ pageToken: '' })
    });

    expect(response.status).toBe(404);
    expect(listBmps).not.toHaveBeenCalled();
});

test('library items carry the stable account id', async () => {
    vi.mocked(listBmps).mockReturnValue(
        resolved({
            items: [
                {
                    fileHash: 'a'.repeat(64),
                    fileId: 'b'.repeat(64),
                    chunkIndex: 0,
                    isLast: true,
                    originalName: 'proof.bin',
                    size: 4,
                    at: 1,
                    mediaKey: 'media-key',
                    sha1: 'c'.repeat(40)
                }
            ],
            nextPageToken: ''
        })
    );

    const response = await postJson('/api/library', { pageToken: '' });
    const body = (await response.json()) as { items: Array<{ accountId?: string }> };

    expect(response.status).toBe(200);
    expect(body.items[0]?.accountId).toBe(ACCOUNT.id);
});

test('file actions dispatch to the shared mutation path with the stable account scope', async () => {
    const baseChunk = {
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1,
        mediaKey: 'media-key',
        sha1: 'c'.repeat(40)
    };
    const body = (action: string, trashed = false) => ({
        action,
        name: 'proof.bin',
        fileHash: baseChunk.fileHash,
        fileId: baseChunk.fileId,
        chunks: [{ ...baseChunk, ...(trashed ? { trashed: true } : {}) }]
    });
    vi.mocked(deleteFile).mockReturnValue(resolved({ applied: [baseChunk] }));
    vi.mocked(restoreFile).mockReturnValue(resolved({ applied: [baseChunk] }));
    vi.mocked(deleteForeverFile).mockReturnValue(resolved({ applied: [baseChunk] }));

    const deleted = await postJson('/api/files', body('delete'));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ applied: [baseChunk] });
    expect(vi.mocked(deleteFile).mock.calls[0]?.[0]).toMatchObject({
        email: ACCOUNT.email,
        token: ACCOUNT.token
    });
    expect(vi.mocked(deleteFile).mock.calls[0]?.[1]).toMatchObject({
        key: ACCOUNT.id,
        coordinator: expect.anything()
    });
    expect(vi.mocked(deleteFile).mock.calls[0]).toHaveLength(2);

    const restored = await postJson('/api/files', body('restore', true));
    expect(restored.status).toBe(200);
    expect(vi.mocked(restoreFile).mock.calls[0]?.[1]).toMatchObject({ key: ACCOUNT.id });
    expect(vi.mocked(restoreFile).mock.calls[0]).toHaveLength(2);

    const removed = await postJson('/api/files', body('delete-forever', true));
    expect(removed.status).toBe(200);
    expect(vi.mocked(deleteForeverFile).mock.calls[0]?.[1]).toMatchObject({ key: ACCOUNT.id });
    expect(vi.mocked(deleteForeverFile).mock.calls[0]?.[2]).toMatchObject({
        load: expect.any(Function),
        save: expect.any(Function),
        remove: expect.any(Function)
    });
});

test('in browser mode, uploads relay finished BMPs with the stored account', async () => {
    vi.mocked(receiveUpload).mockReturnValue(rejected(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));

    await call('/api/upload', { method: 'POST', body: new FormData() });

    expect(vi.mocked(receiveUpload).mock.calls[0].slice(1)).toEqual([ACCOUNT, ChunkFormat.Bmp]);
    expect(receiveFileUpload).not.toHaveBeenCalled();
});

test('in server mode, uploads receive whole files for the server to process', async () => {
    settings.processing = ProcessingMode.Server;
    vi.mocked(receiveFileUpload).mockReturnValue(rejected(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));

    const response = await call('/api/upload', { method: 'POST', body: new FormData() });

    expect(response.status).toBe(400);
    expect(receiveFileUpload).toHaveBeenCalledOnce();
    expect(receiveUpload).not.toHaveBeenCalled();
});

test('raw chunks are relayed unchanged with the stored account', async () => {
    const bytes = Uint8Array.of(66, 77, 1, 2, 3);
    vi.mocked(downloadBmp).mockReturnValue(
        resolved(new Response(bytes, { headers: { 'content-type': 'image/bmp' } }))
    );

    const response = await postJson('/api/chunk', { mediaKey: 'key', sha1: '0'.repeat(40) });

    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(vi.mocked(downloadBmp).mock.calls[0].slice(0, 4)).toEqual([
        ACCOUNT.email,
        ACCOUNT.token,
        'key',
        '0'.repeat(40)
    ]);
});

test('raw chunks use the account selected by the request header', async () => {
    vi.mocked(downloadBmp).mockReturnValue(
        resolved(new Response(Uint8Array.of(66, 77), { headers: { 'content-type': 'image/bmp' } }))
    );

    const response = await call('/api/chunk', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            [GOOGLE_ACCOUNT_HEADER]: 'other-account'
        },
        body: JSON.stringify({ mediaKey: 'key', sha1: '0'.repeat(40) })
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(readGoogleAccount).mock.calls[0][2]).toBe('other-account');
});

test('an unreadable or missing Google account is reported without a token', async () => {
    vi.mocked(readGoogleAccount).mockReturnValue(rejected(AUTH_ERRORS.GOOGLE_ACCOUNT_UNREADABLE));

    const response = await postJson('/api/library', {});
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: AUTH_ERRORS.GOOGLE_ACCOUNT_UNREADABLE.message });
});

test('unknown API paths return JSON not-found errors', async () => {
    const response = await call('/api/missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: AUTH_ERRORS.NOT_FOUND.message });
});
