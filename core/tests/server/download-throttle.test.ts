import { expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { throttleError, type ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { bmpResponse, downloadFixture } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn()
}));

test('a manual download keeps try again on a later chunk', async () => {
    const data = downloadFixture();
    let calls = 0;

    vi.mocked(downloadBmp).mockImplementation(() => {
        calls++;
        if (calls === 2) {
            return Ok(undefined).andThenAsync<Response, ServerError>(async () =>
                Err(throttleError(120, 'manual'))
            );
        }

        return Ok(bmpResponse(data.bmps[0])).andThenAsync(async (response) => Ok(response));
    });

    const response = (
        await downloadFile({ ...data.input, action: FileActionKind.Download }, undefined, 'manual')
    ).unwrap();

    await expect(response.arrayBuffer()).rejects.toMatchObject({
        code: 'THROTTLED',
        retryAfterSeconds: 120,
        message: 'Google Photos is limiting requests, try again in about 2 min'
    });
});
