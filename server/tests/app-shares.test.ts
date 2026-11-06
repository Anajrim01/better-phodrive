import { beforeEach, expect, test, vi } from 'vitest';
import {
    PublicShareSchema,
    ShareChunkSessionSchema,
    type ShareSummary
} from '@madkarmaa/phodrive-core/models';
import { requireSessionUser } from '../src/auth';
import {
    createShare,
    getPublicShare,
    issueShareChunk,
    listShares,
    revokeShare
} from '../src/shares';
import { USER, call, callWith, postJson, rejected, resolved } from './helpers/api';
import { testContext } from './helpers/context';
import { AUTH_ERRORS } from '../src/errors';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';

vi.mock('../src/auth', () => ({
    createAuth: vi.fn(() => ({})),
    handleAuthRequest: vi.fn(),
    readSessionUser: vi.fn(),
    requireSessionUser: vi.fn()
}));
vi.mock('../src/shares', () => ({
    createShare: vi.fn(),
    getPublicShare: vi.fn(),
    issueShareChunk: vi.fn(),
    listShares: vi.fn(),
    revokeShare: vi.fn()
}));

const SHARE: ShareSummary = {
    id: 'share-id',
    kind: 'file',
    name: 'Report',
    status: 'active',
    fileCount: 1,
    createdAt: '2026-11-05T00:00:00.000Z',
    revokedAt: null,
    publicPath: '/s/token'
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSessionUser).mockReturnValue(resolved(USER));
    vi.mocked(createShare).mockReturnValue(resolved(SHARE));
    vi.mocked(listShares).mockReturnValue(resolved([SHARE]));
    vi.mocked(revokeShare).mockReturnValue(resolved({ ...SHARE, status: 'revoked' as const }));
    vi.mocked(getPublicShare).mockReturnValue(
        resolved({
            name: 'Report',
            kind: 'file' as const,
            createdAt: '2026-11-05T00:00:00.000Z',
            files: [
                {
                    id: 'file-id',
                    fileHash: 'a'.repeat(64),
                    name: 'Report.bin',
                    relativeFolder: '',
                    chunkCount: 1,
                    size: 10
                }
            ]
        })
    );
    vi.mocked(issueShareChunk).mockReturnValue(
        resolved({
            url: 'https://edge.example/api/bytes',
            capability: 'opaque-capability',
            expiresAt: '2026-11-05T00:05:00.000Z',
            chunk: { index: 0, size: 10, isLast: true }
        })
    );
});

test('public issuance returns retryable 429 responses for Google and admission limits', async () => {
    for (const failure of [
        { code: 'THROTTLED' as const, message: 'Wait for Google.', retryAfterSeconds: 30 },
        { ...SERVER_ERRORS.SHARE_BUSY, retryAfterSeconds: 17 }
    ]) {
        vi.mocked(issueShareChunk).mockReturnValue(rejected(failure));
        const response = await call('/api/public/shares/token/files/file-id/chunks/0', {
            method: 'POST'
        });
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBe(String(failure.retryAfterSeconds));
        expect(await response.json()).toEqual({ error: failure.message });
    }
});

test('share routes require a session and pass the user to every operation', async () => {
    vi.mocked(requireSessionUser).mockReturnValue(rejected(AUTH_ERRORS.SIGNED_OUT));

    const created = await postJson('/api/shares', {});
    expect(created.status).toBe(401);
    expect(createShare).not.toHaveBeenCalled();

    vi.mocked(requireSessionUser).mockReturnValue(resolved(USER));
    const createdAgain = await postJson('/api/shares', {
        kind: 'file',
        requestKey: crypto.randomUUID(),
        name: 'Report',
        context: { kind: 'account', id: 'account-id' },
        accountId: 'account-id',
        fileId: 'a'.repeat(64)
    });
    expect(createdAgain.status).toBe(200);
    expect(vi.mocked(createShare).mock.calls[0]?.slice(1, 3)).toEqual([
        USER.id,
        expect.objectContaining({ kind: 'file', name: 'Report' })
    ]);

    expect((await call('/api/shares')).status).toBe(200);
    expect(vi.mocked(listShares).mock.calls[0]?.[1]).toBe(USER.id);

    expect((await call('/api/shares/share-id/revoke', { method: 'POST' })).status).toBe(200);
    expect(vi.mocked(revokeShare).mock.calls[0]?.slice(1, 3)).toEqual([USER.id, 'share-id']);
});

test('the public manifest and chunk session routes do not require a session', async () => {
    vi.mocked(requireSessionUser).mockReturnValue(rejected(AUTH_ERRORS.SIGNED_OUT));

    const manifest = await call('/api/public/shares/token');
    expect(manifest.status).toBe(200);
    expect(PublicShareSchema.safeParse(await manifest.json()).success).toBe(true);
    expect(vi.mocked(getPublicShare).mock.calls[0]?.[1]).toBe('token');

    const chunk = await call('/api/public/shares/token/files/file-id/chunks/0', {
        method: 'POST'
    });
    expect(chunk.status).toBe(200);
    expect(ShareChunkSessionSchema.safeParse(await chunk.json()).success).toBe(true);
    expect(vi.mocked(issueShareChunk).mock.calls[0]?.slice(1, 4)).toEqual(['token', 'file-id', 0]);
});

test('sharing off preserves signed-in listing and local revoke', async () => {
    const context = testContext({ sharing: null });

    expect((await callWith(context, '/api/shares')).status).toBe(200);
    expect(
        (await callWith(context, '/api/shares/share-id/revoke', { method: 'POST' })).status
    ).toBe(200);
    expect(listShares).toHaveBeenCalledWith(context.db, USER.id);
    expect(revokeShare).toHaveBeenCalledWith(context, USER.id, 'share-id');

    vi.mocked(requireSessionUser).mockReturnValue(rejected(AUTH_ERRORS.SIGNED_OUT));
    expect((await callWith(context, '/api/shares')).status).toBe(401);
    expect(
        (await callWith(context, '/api/shares/share-id/revoke', { method: 'POST' })).status
    ).toBe(401);
});

test('sharing off rejects creation and public reads before Google work', async () => {
    const context = testContext({ sharing: null });
    const requests: [string, RequestInit][] = [
        ['/api/shares', { method: 'POST', body: '{}' }],
        ['/api/public/shares/token', {}],
        ['/api/public/shares/token/files/file-id/chunks/0', { method: 'POST' }]
    ];

    for (const [path, init] of requests) {
        const response = await callWith(context, path, init);

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
            error: 'Public sharing is not configured on this server.'
        });
    }

    expect(createShare).not.toHaveBeenCalled();
    expect(revokeShare).not.toHaveBeenCalled();
    expect(getPublicShare).not.toHaveBeenCalled();
    expect(issueShareChunk).not.toHaveBeenCalled();
});
