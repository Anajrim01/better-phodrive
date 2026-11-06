import { expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';

const { apiJson } = vi.hoisted(() => ({ apiJson: vi.fn() }));

vi.mock('@madkarmaa/phodrive-core/browser/api', () => ({ apiJson }));

const { getShareChunk, getPublicShare } = await import('#browser/shares');

const SESSION = {
    url: 'https://edge.example/api/bytes',
    capability: 'capability',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    chunk: { index: 0, size: 10, isLast: true }
};

function sessionResult() {
    return Ok(undefined).andThenAsync(async () => Ok(SESSION));
}

test('a manifest request carries its lifecycle abort signal', async () => {
    apiJson.mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Ok({ name: 'Share', kind: 'file', createdAt: '2026-11-06T00:00:00.000Z', files: [] })
        )
    );
    const controller = new AbortController();
    await getPublicShare('token', controller.signal);
    expect(apiJson).toHaveBeenCalledWith(
        '/api/public/shares/token',
        { method: 'GET', signal: controller.signal },
        expect.any(String)
    );
});

test('a chunk request carries the abort signal', async () => {
    apiJson.mockReturnValue(sessionResult());
    const controller = new AbortController();

    const result = await getShareChunk('token', 'file', 0, controller.signal);

    expect(result.unwrap()).toEqual(SESSION);
    expect(apiJson).toHaveBeenCalledWith(
        expect.stringContaining('/chunks/0'),
        expect.objectContaining({ method: 'POST', signal: controller.signal }),
        expect.any(String)
    );
});

test('a chunk request without a signal sends no signal', async () => {
    apiJson.mockReturnValue(sessionResult());

    await getShareChunk('token', 'file', 0);

    expect(apiJson).toHaveBeenCalledWith(
        expect.stringContaining('/chunks/0'),
        { method: 'POST' },
        expect.any(String)
    );
});
