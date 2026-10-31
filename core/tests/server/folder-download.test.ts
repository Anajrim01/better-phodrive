import { expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { bmpResponse, downloadFixture } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn()
}));

test('a folder chunk round-trips through the download stream', async () => {
    const original = Buffer.from([1, 2, 3, 4]);
    const { input, bmps } = downloadFixture(original, 'nested.bin', undefined, 'photos/2024');

    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) =>
        Ok(bmpResponse(bmps[Number(key.slice(-1))], 32)).andThenAsync(async (response) =>
            Ok(response)
        )
    );

    const downloaded = await downloadFile(input);
    const bytes = await downloaded.unwrap().arrayBuffer();

    expect(Buffer.from(bytes)).toEqual(original);
});
