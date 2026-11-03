import { afterEach, expect, test, vi } from 'vitest';
import { checkShareViewer } from '#browser/share-viewer';

afterEach(() => vi.restoreAllMocks());

test('a reachable viewer origin makes sharing available', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));

    const available = await checkShareViewer('https://shared.phodrive.dev/#share=');

    expect(available.unwrap()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
        'https://shared.phodrive.dev',
        expect.objectContaining({ method: 'HEAD', mode: 'no-cors', cache: 'no-store' })
    );
});

test('a missing viewer keeps create hidden', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('dns failure'));

    const available = await checkShareViewer('https://shared.phodrive.dev/#share=');

    expect(available.unwrap()).toBe(false);
});

test('an invalid viewer URL is treated as unavailable', async () => {
    const available = await checkShareViewer('not a url');

    expect(available.unwrap()).toBe(false);
});
