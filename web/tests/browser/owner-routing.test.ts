import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import {
    FileActionRequestSchema,
    GOOGLE_ACCOUNT_HEADER,
    ProcessingMode
} from '@madkarmaa/phodrive-core/models';
import { groupChunks, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { downloadFile, deleteFile, restoreFile, deleteForeverFile } from '#browser/files';
import { downloadChunks } from '@madkarmaa/phodrive-core/browser/download';
import { uploadFileRequest } from '@madkarmaa/phodrive-core/browser/upload/request';
import { bmpResponse, downloadFixture } from '../../../core/tests/helpers/download';
import { chunk, PAYLOAD } from '../helpers/files';

const OWNER = 'account-owner';

function ownedChunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return { ...chunk(), email: 'owner@example.com', accountId: OWNER, ...overrides };
}

function header(init: RequestInit | undefined): string | null {
    return new Headers(init?.headers).get(GOOGLE_ACCOUNT_HEADER);
}

function expectOwnerFreeBody(init: RequestInit | undefined) {
    const body = JSON.parse(String(init?.body)) as {
        email?: unknown;
        accountId?: unknown;
        chunks: Array<Record<string, unknown>>;
    };

    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('accountId');
    for (const item of body.chunks) {
        expect(item).not.toHaveProperty('email');
        expect(item).not.toHaveProperty('accountId');
    }

    FileActionRequestSchema.parse(body);
}

afterEach(() => vi.restoreAllMocks());

test('server-mode download carries the file owner account id', async () => {
    const group = groupChunks([ownedChunk()])[0];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        expect(header(init)).toBe(OWNER);
        expect(String(init?.body)).not.toContain('owner@example.com');
        expect(String(init?.body)).not.toContain(OWNER);
        expectOwnerFreeBody(init);

        return new Response(PAYLOAD);
    });

    await downloadFile(group, ProcessingMode.Server).unwrap();

    expect(fetchMock).toHaveBeenCalledOnce();
});

test('delete carries the file owner only in the header', async () => {
    const group = groupChunks([ownedChunk()])[0];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        expect(header(init)).toBe(OWNER);
        expect(String(init?.body)).not.toContain('owner@example.com');
        expect(String(init?.body)).not.toContain(OWNER);
        expectOwnerFreeBody(init);

        return Response.json({ applied: [chunk()] });
    });

    await deleteFile(group, () => {}).unwrap();

    expect(fetchMock).toHaveBeenCalledOnce();
});

test.each([
    ['restore', restoreFile, 'restore'],
    ['delete forever', deleteForeverFile, 'delete-forever']
] as const)('%s carries the file owner only in the header', async (_name, action, expected) => {
    const group = groupChunks([ownedChunk({ trashed: true })])[0];
    let body: { action?: string } = {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        expect(header(init)).toBe(OWNER);
        expect(String(init?.body)).not.toContain('owner@example.com');
        expect(String(init?.body)).not.toContain(OWNER);
        expectOwnerFreeBody(init);
        body = JSON.parse(String(init?.body)) as { action?: string };

        return Response.json({ applied: [ownedChunk({ trashed: true })] });
    });

    await action(group, () => {}).unwrap();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(body.action).toBe(expected);
});

test('browser-mode chunk requests use the owning account for every chunk', async () => {
    const fixture = downloadFixture();
    const group = groupChunks([
        ...fixture.input.chunks.map((item) => ({
            ...item,
            email: 'owner@example.com',
            accountId: OWNER
        }))
    ])[0];
    let calls = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        expect(url).toBe('/api/chunk');
        expect(header(init)).toBe(OWNER);
        expect(String(init?.body)).not.toContain(OWNER);
        expect(String(init?.body)).not.toContain('owner@example.com');

        return bmpResponse(fixture.bmps[calls++]);
    });

    const downloaded = await downloadChunks(group);
    const bytes = new Uint8Array(await downloaded.unwrap().arrayBuffer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([...bytes]).toEqual([...fixture.original]);
});

test('server-mode upload request carries the selected account id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        expect(header(init)).toBe(OWNER);
        expect(init?.body).toBeInstanceOf(FormData);

        return Response.json({ error: 'stop after header check' }, { status: 400 });
    });

    const result = await uploadFileRequest(
        new File([PAYLOAD], 'proof.bin'),
        1,
        () => Ok(undefined),
        OWNER
    );

    expect(result.isErr()).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
});

test('an ownerless file does not send an account header', async () => {
    const group = groupChunks([{ ...chunk(), email: 'test@example.com' }])[0];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        expect(header(init)).toBeNull();
        expect(String(init?.body)).not.toContain('test@example.com');
        expectOwnerFreeBody(init);

        return new Response(PAYLOAD);
    });

    await downloadFile(group, ProcessingMode.Server).unwrap();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await downloadFile({ ...group, complete: false }, ProcessingMode.Server)).isErr()).toBe(
        true
    );
});
