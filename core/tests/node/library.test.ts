import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { readLibrary } from '@madkarmaa/phodrive-core/node';
import { downloadFixture } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({ listBmps: vi.fn() }));

afterEach(() => vi.clearAllMocks());

function pages(...responses: { items: number[]; nextPageToken: string }[]) {
    const { input } = downloadFixture();
    for (const { items, nextPageToken } of responses)
        vi.mocked(listBmps).mockImplementationOnce(() =>
            Ok({ items: items.map((index) => input.chunks[index]), nextPageToken }).andThenAsync(
                async (page) => Ok(page)
            )
        );

    return input;
}

test('every page is read and grouped into files', async () => {
    const input = pages({ items: [1], nextPageToken: 'next' }, { items: [0], nextPageToken: '' });

    const library = await readLibrary('test@example.com', 'aas_et/test');

    const files = library.unwrap();
    expect(vi.mocked(listBmps).mock.calls.map((call) => call[2])).toEqual(['', 'next']);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
        name: input.name,
        email: 'test@example.com',
        complete: true,
        chunkCount: 2
    });
});

test('a repeated page token stops the read', async () => {
    pages({ items: [0], nextPageToken: 'loop' }, { items: [1], nextPageToken: 'loop' });

    const library = await readLibrary('test@example.com', 'aas_et/test');

    expect(library.unwrapErr()).toBe(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);
});
