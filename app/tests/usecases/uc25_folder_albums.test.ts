import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { DriveController } from '#browser/drive/index.svelte';
import * as filesApi from '#browser/files';
import * as albumsApi from '@madkarmaa/phodrive-core/browser/albums';
import * as libraryApi from '@madkarmaa/phodrive-core/browser/library';
import { ThemeMode, UploadJobStatus, UploadStatus } from '@madkarmaa/phodrive-core/models';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { ALBUMS_KEY, CONCURRENT_WORKERS_KEY, SELECTED_KEY } from '#browser/storage';

const { storage } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value)
    };
    const tab = Object.assign(new EventTarget(), { localStorage: storage });
    vi.stubGlobal('window', tab);
    vi.stubGlobal('document', {
        hidden: false,
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

const OWNER = 'owner@example.com';
const TOKEN = 'aas_et/owner-token';
const FOLDER = 'trip/2024';

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    vi.restoreAllMocks();
    storage.clear();
    storage.setItem('accounts', JSON.stringify({ [OWNER]: TOKEN }));
    storage.setItem(SELECTED_KEY, JSON.stringify(OWNER));
    storage.setItem(CONCURRENT_WORKERS_KEY, '1');
});

afterAll(() => vi.unstubAllGlobals());

function chunk(fileId: string, name: string): UploadedChunk {
    return {
        email: OWNER,
        folder: FOLDER,
        fileHash: fileId,
        fileId,
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        size: 12,
        at: 1,
        mediaKey: `key-${fileId}`,
        sha1: 'b'.repeat(40)
    };
}

function uploadWithChunks(): void {
    vi.spyOn(filesApi, 'uploadFiles').mockImplementation(
        (files, _email, _token, _workers, onJob, onChunk) =>
            Ok(undefined).andThenAsync(async () => {
                const jobs = filesApi.createUploadJobs(files);

                for (const [id, job] of jobs.entries()) {
                    const fileId = id.toString(16).padStart(32, '0').repeat(2);
                    onChunk(chunk(fileId, job.name));
                    onJob({
                        ...job,
                        status: UploadJobStatus.Complete,
                        result: {
                            status: UploadStatus.Uploaded,
                            mediaKey: `key-${fileId}`,
                            sha1: 'b'.repeat(40)
                        }
                    });
                }

                return Ok(undefined);
            })
    );
}

function assignment(index: number) {
    const call = vi.mocked(albumsApi.assignFolderAlbum).mock.calls[index];
    if (!call) throw new Error(`Expected album assignment ${index}.`);

    return call;
}

test('uploaded folders become albums and reuse the remembered album key', async () => {
    vi.spyOn(libraryApi, 'readLibraryPage').mockReturnValue(
        Ok({ items: [], nextPageToken: '' }).andThenAsync(async (page) => Ok(page))
    );
    const assigned = vi
        .spyOn(albumsApi, 'assignFolderAlbum')
        .mockReturnValue(Ok('album-key').andThenAsync(async (key) => Ok(key)));
    const drive = new DriveController();
    drive.initialize();
    drive.library.folder = FOLDER;
    uploadWithChunks();

    await drive.upload([new File(['one'], 'one.txt'), new File(['two'], 'two.txt')]);

    expect(assigned).toHaveBeenCalledTimes(1);
    const [email, token, folder, albumKey, mediaKeys] = assignment(0);
    expect({ email, token, folder, albumKey }).toEqual({
        email: OWNER,
        token: TOKEN,
        folder: FOLDER,
        albumKey: undefined
    });
    expect(mediaKeys).toHaveLength(2);
    expect(storage.getItem(ALBUMS_KEY)).toContain('album-key');
    expect(drive.feedbackMessage).toBe('');

    await drive.upload([new File(['three'], 'three.txt')]);

    expect(assigned).toHaveBeenCalledTimes(2);
    expect(assignment(1)[3]).toBe('album-key');
});

test('a failed album assignment keeps the upload and reports the folder', async () => {
    vi.spyOn(libraryApi, 'readLibraryPage').mockReturnValue(
        Ok({ items: [], nextPageToken: '' }).andThenAsync(async (page) => Ok(page))
    );
    vi.spyOn(albumsApi, 'assignFolderAlbum').mockReturnValue(
        Err({
            code: 'REQUEST_FAILED',
            message: 'Could not add files to the folder album.'
        } as const).andThenAsync(async () => Ok(''))
    );
    const drive = new DriveController();
    drive.initialize();
    drive.library.folder = FOLDER;
    uploadWithChunks();

    await drive.upload([new File(['one'], 'one.txt')]);

    expect(drive.busy).toBe(false);
    expect(drive.uploadJobs[0]?.status).toBe(UploadJobStatus.Complete);
    expect(drive.feedbackMessage).toContain(FOLDER);
});

test('retrying an upload keeps its original folder', async () => {
    vi.spyOn(libraryApi, 'readLibraryPage').mockReturnValue(
        Ok({ items: [], nextPageToken: '' }).andThenAsync(async (page) => Ok(page))
    );
    const folders: (string | undefined)[] = [];
    vi.spyOn(filesApi, 'uploadFiles').mockImplementation(
        (files, _email, _token, _workers, onJob, _onChunk, options) => {
            folders.push(options?.folder);

            return Ok(undefined).andThenAsync(async () => {
                for (const job of filesApi.createUploadJobs(files))
                    onJob({
                        ...job,
                        status: UploadJobStatus.Error,
                        message: 'Upload failed.'
                    });

                return Ok(undefined);
            });
        }
    );
    const drive = new DriveController();
    drive.initialize();
    drive.library.folder = 'photos';

    await drive.upload([new File(['retry'], 'retry.txt')]);
    drive.library.folder = 'other';
    await drive.retryUpload(0);

    expect(folders).toEqual(['photos', 'photos']);
});
